from datetime import timedelta
from django.test import TestCase, Client
from django.contrib.auth.models import User, Group
from django.utils import timezone
from .models import (
    Device,
    Cabinet,
    Rack,
    Shelf,
    Bin,
    Item,
    Stock,
    RolePermission,
    InventoryTransaction,
    AuditLog,
    Alarm,
    RackStatus,
    EnvironmentStatus,
    Outbox,
)
from .services import refresh
from .monitoring import ingest
from ipc_core.protocol import envelope, encode, topic
from .mqtt import receive


class ConsoleTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("root", "", "test-password")
        self.user = User.objects.create_user("scoped", password="test-password")
        self.role = Group.objects.create(name="Any arbitrary role name")
        self.user.groups.add(self.role)
        self.item = Item.objects.create(code="A", name="Part", unit="pcs")
        self.targets = {}
        for domain in ["IPC", "IPCSIM"]:
            d = Device.objects.create(
                device_id=domain,
                device_type=domain,
                name=domain,
                last_seen=timezone.now(),
                serial_connected=True,
            )
            c = Cabinet.objects.create(code="C", name="Group", domain=domain, device=d)
            r = Rack.objects.create(cabinet=c, address=1, name="Rack 1")
            s = Shelf.objects.create(rack=r, code="S")
            b = Bin.objects.create(shelf=s, code="P1", capacity=100)
            b2 = Bin.objects.create(shelf=s, code="P2", capacity=100)
            refresh(d)
            d.acknowledged_revision = d.revision
            d.save()
            self.targets[domain] = (d, r, b, b2)
        self.client.force_login(self.admin)

    def grant(self, permission, scope="SIMULATION"):
        RolePermission.objects.create(
            role=self.role, permission=permission, scope=scope
        )

    def post(self, path, data):
        return self.client.post("/api/" + path, data, content_type="application/json")

    def tx(self, kind, quantity, origin=None, target=None, **extra):
        return self.post(
            "inventory-transactions",
            dict(
                kind=kind,
                quantity=quantity,
                item_id=self.item.pk,
                from_location_id=origin.pk if origin else None,
                to_location_id=target.pk if target else None,
                note="Counted physically",
                request_key=str(InventoryTransaction.objects.count()) + kind,
                **extra,
            ),
        )

    def test_default_real_and_all_filters(self):
        self.assertEqual(
            [r["source_type"] for r in self.client.get("/api/ipcs").json()], ["REAL"]
        )
        self.assertEqual(len(self.client.get("/api/ipcs?source_type=ALL").json()), 2)
        self.assertEqual(self.client.get("/api/ipcs?source_type=bad").status_code, 400)
        self.grant("ipc.view")
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/api/ipcs").status_code, 403)
        rows = self.client.get("/api/devices?source_type=ALL").json()
        self.assertEqual([r["device_type"] for r in rows], ["IPCSIM"])
        self.assertEqual(self.client.get("/api/racks?source_type=ALL").status_code, 403)

    def test_scope_cannot_be_bypassed_with_old_endpoints_or_request_payload(self):
        self.grant("cabinet.control")
        self.grant("cabinet.view")
        self.client.force_login(self.user)
        d, r, _, _ = self.targets["IPC"]
        self.assertEqual(
            self.post(
                f"racks/{r.pk}/commands",
                {"command": "OPEN", "source_type": "SIMULATION"},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.post(
                "operations",
                {
                    "device_id": d.pk,
                    "rack_id": r.pk,
                    "kind": "OPEN",
                    "request_key": "denied",
                },
            ).status_code,
            403,
        )
        d, r, _, _ = self.targets["IPCSIM"]
        response = self.post(
            f"racks/{r.pk}/commands", {"command": "OPEN", "request_key": "ok"}
        )
        self.assertEqual(response.status_code, 201, response.content)
        out = Outbox.objects.get(channel="command")
        self.assertEqual(out.device_id, d.pk)
        self.assertEqual(out.body["payload"]["rack_id"], r.pk)

    def test_inventory_move_borrow_return_adjust_and_idempotency(self):
        _, _, a, b = self.targets["IPC"]
        response = self.tx("INBOUND", 10, target=a)
        self.assertEqual(response.status_code, 201, response.content)
        data = {
            "kind": "MOVE",
            "quantity": 4,
            "item_id": self.item.pk,
            "from_location_id": a.pk,
            "to_location_id": b.pk,
            "note": "Moved",
            "request_key": "move",
        }
        first = self.post("inventory-transactions", data)
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(self.post("inventory-transactions", data).json(), first.json())
        self.assertEqual(Stock.objects.get(bin=a).quantity, 6)
        self.assertEqual(Stock.objects.get(bin=b).quantity, 4)
        loan = self.tx("BORROW", 3, origin=b).json()["id"]
        response = self.tx("RETURN", 2, target=a, borrow_id=loan)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            self.tx("RETURN", 2, target=a, borrow_id=loan).status_code, 400
        )
        self.assertEqual(self.tx("ADJUST", 0, target=b).status_code, 201)
        self.assertEqual(Stock.objects.get(bin=b).quantity, 0)
        self.assertEqual(InventoryTransaction.objects.count(), 5)
        self.assertEqual(
            AuditLog.objects.filter(resource="inventory-transaction").count(), 5
        )

    def test_invalid_movements_rollback(self):
        _, _, a, b = self.targets["IPC"]
        other = self.targets["IPCSIM"][2]
        self.assertEqual(self.tx("INBOUND", 10, target=a).status_code, 201)
        self.assertEqual(self.tx("MOVE", 2, origin=a, target=other).status_code, 400)
        self.assertEqual(self.tx("OUTBOUND", 11, origin=a).status_code, 400)
        b.reserved = True
        b.save()
        self.assertEqual(self.tx("MOVE", 2, origin=a, target=b).status_code, 400)
        self.assertEqual(Stock.objects.get(bin=a).quantity, 10)
        self.assertFalse(Stock.objects.filter(bin=b).exists())
        self.client.force_login(self.user)
        self.grant("inventory.move")
        self.assertEqual(self.tx("INBOUND", 2, target=a).status_code, 403)

    def test_signed_telemetry_alarm_lifecycle_dedup_and_stale_sample(self):
        d, r, _, _ = self.targets["IPCSIM"]
        msg = envelope(
            d.pk,
            d.device_type,
            "telemetry.sample",
            {"rack_id": 1, "temperature": 60, "humidity": 40, "smoke": 1},
        )
        receive(topic(d.pk, "up", "telemetry"), encode(msg))
        receive(topic(d.pk, "up", "telemetry"), encode(msg))
        self.assertEqual(EnvironmentStatus.objects.count(), 1)
        self.assertEqual(Alarm.objects.filter(active=True).count(), 2)
        alarm = Alarm.objects.get(code="smoke")
        self.grant("alarm.view", "REAL")
        self.client.force_login(self.user)
        self.assertEqual(
            self.post(f"alarms/{alarm.pk}/acknowledge", {}).status_code, 403
        )
        self.grant("alarm.acknowledge")
        self.assertEqual(
            self.post(f"alarms/{alarm.pk}/acknowledge", {}).status_code, 200
        )
        ingest(
            d,
            {"rack_id": 1, "smoke": 0},
            (timezone.now() - timedelta(hours=1)).isoformat(),
        )
        alarm.refresh_from_db()
        self.assertTrue(alarm.active)
        ingest(d, {"rack_id": 1, "smoke": 0}, timezone.now().isoformat())
        alarm.refresh_from_db()
        self.assertFalse(alarm.active)
        self.assertEqual(alarm.acknowledged_by, self.user)
        self.assertEqual(RackStatus.objects.get(rack=r).values["temperature"], 60)
        self.assertTrue(Alarm.objects.get(code="temperature").active)

    def test_all_console_routes_and_rbac_mutations(self):
        for name in [
            "dashboard",
            "ipcs",
            "cabinet-groups",
            "rack-status",
            "environment",
            "alarms",
            "goods",
            "storage-locations",
            "inventory-transactions",
            "users",
            "roles",
            "permissions",
            "audit-logs",
            "settings",
        ]:
            response = self.client.get("/api/" + name + "?source_type=ALL")
            self.assertEqual(response.status_code, 200, (name, response.content))
        r = self.post(
            "roles",
            {
                "name": "SIM control",
                "permissions": [
                    {"permission": "cabinet.control", "scope": "SIMULATION"}
                ],
            },
        )
        self.assertEqual(r.status_code, 201, r.content)
        r = self.post(
            "users",
            {
                "username": "new",
                "password": "Long-password-347!",
                "roles": [r.json()["id"]],
            },
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(
            User.objects.get(username="new").check_password("Long-password-347!")
        )
        self.assertNotIn("password", str(list(AuditLog.objects.values("after"))))
        self.assertEqual(
            self.post(
                "roles",
                {
                    "name": "bad",
                    "permissions": [{"permission": "nope", "scope": "ALL"}],
                },
            ).status_code,
            400,
        )
        self.assertFalse(Group.objects.filter(name="bad").exists())
        self.client.force_login(self.user)
        self.assertEqual(
            self.post("roles", {"name": "elevated", "permissions": []}).status_code, 403
        )
        self.assertEqual(
            self.post(
                "users", {"username": "hacker", "is_superuser": True}
            ).status_code,
            403,
        )

    def test_csrf_and_unauthenticated_writes(self):
        self.client.logout()
        self.assertEqual(self.post("inventory-transactions", {}).status_code, 401)
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.admin)
        self.assertEqual(
            client.post(
                "/api/settings", {"key": "humidity_max", "value": 70}
            ).status_code,
            403,
        )
