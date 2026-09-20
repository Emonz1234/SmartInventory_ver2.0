from datetime import timedelta
from django.test import TestCase, Client
from django.contrib.auth import get_user_model
from django.utils import timezone
from ipc_core.protocol import envelope, encode, topic
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger, Outbox
from .services import assign, create_operation, confirm_operation, refresh
from .mqtt import receive


class InventoryTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_superuser("operator", "", "test-password")
        self.item = Item.objects.create(code="PART", name="Part", unit="piece")
        self.devices = []
        for idx, kind in enumerate(["IPC", "IPCSIM", "IPCSIM"]):
            d = Device.objects.create(device_id=f"device-{idx}", device_type=kind, name=kind, secret="x"*48, last_seen=timezone.now(), serial_connected=True)
            c = Cabinet.objects.create(code=f"cab-{idx}", name="Cabinet", domain=kind)
            r = Rack.objects.create(cabinet=c, address=1)
            s = Shelf.objects.create(rack=r, code="shelf")
            b = Bin.objects.create(shelf=s, code="bin")
            Stock.objects.create(item=self.item, bin=b, quantity=10)
            assign(c.pk, d.pk)
            d.refresh_from_db()
            d.acknowledged_revision = d.revision
            d.save()
            self.devices.append((d, c, r, b))

    def command(self, index=1):
        d, c, r, b = self.devices[index]
        return create_operation(self.user, dict(device_id=d.pk, rack_id=r.pk, item_id=self.item.pk,
            bin_id=b.pk, kind="PICK", quantity=3, request_key=f"request-{index}"))

    def result(self, op, state="sent"):
        d = op.device
        msg = envelope(d.pk, d.device_type, "events.command_result", {"state": state}, command_id=str(op.pk))
        receive(topic(d.pk, "up", "events"), encode(msg, d.secret))
        return msg

    def test_inventory_confirmation_is_atomic_idempotent_and_domain_isolated(self):
        op = self.command()
        self.assertEqual(Stock.objects.get(bin=op.bin).quantity, 10)
        msg = self.result(op)
        receive(topic(op.device_id, "up", "events"), encode(msg, op.device.secret))
        confirm_operation(self.user, op.pk, "Operator counted actual removal")
        confirm_operation(self.user, op.pk, "Duplicate confirmation")
        self.assertEqual(Stock.objects.get(bin=op.bin).quantity, 7)
        self.assertEqual(Stock.objects.get(bin=self.devices[0][3]).quantity, 10)
        self.assertEqual(Ledger.objects.count(), 1)

    def test_scoped_snapshots_and_assignment_domain(self):
        for d, c, r, b in self.devices:
            d.refresh_from_db()
            ids = [x["data"]["id"] for x in d.snapshot if x["kind"] == "rack"]
            self.assertEqual(ids, [r.pk])
        with self.assertRaises(ValueError):
            assign(self.devices[0][1].pk, self.devices[1][0].pk)

    def test_reassignment_revokes_old_read_model(self):
        d, c, r, b = self.devices[1]
        assign(c.pk, None)
        d.refresh_from_db()
        self.assertFalse(any(x["kind"] == "rack" for x in d.snapshot))

    def test_spoofed_type_secret_and_cross_device_result(self):
        op = self.command()
        d = op.device
        msg = envelope(d.pk, "IPC", "events.command_result", {"state": "sent"}, command_id=str(op.pk))
        with self.assertRaises(ValueError):
            receive(topic(d.pk, "up", "events"), encode(msg, d.secret))
        msg["device_type"] = d.device_type
        with self.assertRaises(ValueError):
            receive(topic(d.pk, "up", "events"), encode(msg, "z"*48))

    def test_offline_no_operation(self):
        d = self.devices[1][0]
        d.last_seen = timezone.now()-timedelta(minutes=5)
        d.save()
        with self.assertRaises(ValueError):
            self.command()

    def test_request_dedup_and_pending_assignment_block(self):
        first = self.command()
        self.assertEqual(self.command().pk, first.pk)
        with self.assertRaises(ValueError):
            assign(self.devices[1][1].pk, None)

    def test_ack_cannot_advance_arbitrary_revision(self):
        d = self.devices[1][0]
        out = Outbox.objects.filter(device=d, channel="sync").first()
        msg = envelope(d.pk, d.device_type, "ack.applied", {}, correlation_id=str(out.pk), dataset_id=d.pk, revision=999)
        with self.assertRaises(ValueError):
            receive(topic(d.pk, "up", "ack"), encode(msg, d.secret))

    def test_rest_authentication_and_csrf(self):
        c = Client(enforce_csrf_checks=True)
        self.assertEqual(c.get("/api/devices").status_code, 401)
        self.assertEqual(c.post("/api/session", {}, content_type="application/json").status_code, 403)
        c.force_login(self.user)
        self.assertEqual(c.get("/api/devices").status_code, 200)
        self.assertEqual(c.post("/api/operations", {}, content_type="application/json").status_code, 403)

    def test_timeout_never_invents_failure_or_inventory_success(self):
        from .services import expire_operations
        op = self.command()
        Operation.objects.filter(pk=op.pk).update(expires_at=timezone.now()-timedelta(minutes=2))
        expire_operations()
        op.refresh_from_db()
        self.assertEqual((op.state, op.execution_state), ('uncertain', 'timeout'))
        self.assertEqual(Stock.objects.get(bin=op.bin).quantity, 10)

    def test_initial_endpoint_is_not_execution_confirmation(self):
        op = self.command()
        device = op.device
        def telemetry(payload):
            message = envelope(device.pk, device.device_type, 'events.serial', dict(rack_id=op.rack.address, **payload))
            receive(topic(device.pk, 'up', 'events'), encode(message, device.secret))
            op.refresh_from_db()
        telemetry(dict(state=-1, is_endpoint=1, displacement=64))
        self.assertEqual(op.execution_state, 'awaiting_device')
        telemetry(dict(state=1, is_endpoint=0, displacement=20))
        self.assertEqual(op.execution_state, 'moving')
        telemetry(dict(state=-1, is_endpoint=1, displacement=64))
        self.assertEqual(op.execution_state, 'completed')
        self.assertEqual(Stock.objects.get(bin=op.bin).quantity, 10)

    def test_read_only_operator_cannot_request_operation(self):
        user = get_user_model().objects.create_user('viewer', password='test')
        self.client.force_login(user)
        self.assertEqual(self.client.post('/api/operations', {}, content_type='application/json').status_code, 403)
