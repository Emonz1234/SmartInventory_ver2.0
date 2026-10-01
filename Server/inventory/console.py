"""Source-scoped server console API, reusing the existing inventory and MQTT services."""

from uuid import uuid4
from django.contrib.auth.models import User, Group
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.db.models import Sum
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from .models import (
    Device,
    Cabinet,
    Rack,
    Bin,
    Stock,
    Item,
    Alarm,
    EnvironmentStatus,
    InventoryTransaction,
    AuditLog,
    RolePermission,
    SystemSetting,
)
from .permissions import require, sources, source, SOURCE_DOMAIN, PERMISSIONS, allowed
from .services import online, create_operation
from .stock import transact
from .views import api, body


def values(qs, request):
    offset = int(request.GET.get("offset", 0))
    limit = int(request.GET.get("limit", 200))
    if offset < 0 or not 1 <= limit <= 1000:
        raise ValueError("offset must be nonnegative; limit must be 1..1000")
    return list(qs.values()[offset : offset + limit])


def audit(user, action, resource, pk, scope="ALL", before=None, after=None):
    AuditLog.objects.create(
        actor=user,
        action=action,
        resource=resource,
        object_id=str(pk),
        source_type=scope,
        before=before or {},
        after=after or {},
    )


def location_row(b):
    c = b.shelf.rack.cabinet
    stocks = list(
        b.stock_set.filter(quantity__gt=0).values("item_id", "item__name", "quantity")
    )
    return dict(
        id=b.pk,
        code=b.code,
        area=c.area,
        cabinet_id=c.pk,
        cabinet=c.name,
        rack_id=b.shelf.rack_id,
        rack=b.shelf.rack.name,
        shelf_id=b.shelf_id,
        shelf=b.shelf.code,
        ipc_id=c.device_id,
        source_type=source(c.domain),
        capacity=b.capacity,
        status="reserved" if b.reserved else "occupied" if stocks else "empty",
        goods=stocks,
    )


def rack_row(r):
    status = getattr(r, "rackstatus", None)
    return dict(
        id=r.pk,
        cabinet_id=r.cabinet_id,
        cabinet=r.cabinet.name,
        ipc_id=r.cabinet.device_id,
        name=r.name,
        address=r.address,
        source_type=source(r.cabinet.domain),
        online=bool(r.cabinet.device and online(r.cabinet.device)),
        last_update=status.updated_at if status else None,
        **(status.values if status else {})
    )


@api()
def console(request, resource, pk=None):
    method = request.method
    data = body(request) if method in ["POST", "PATCH", "DELETE"] else {}
    if method not in ["GET", "POST", "PATCH", "DELETE"]:
        return JsonResponse({"error": "Method not allowed"}, status=405)
    permission = {
        "dashboard": "dashboard.view",
        "ipcs": "ipc.view",
        "cabinet-groups": "cabinet.view",
        "rack-status": "cabinet.view",
        "environment": "environment.view",
        "alarms": "alarm.view",
        "goods": "inventory.view",
        "storage-locations": "inventory.view",
        "inventory-transactions": "inventory.view",
        "audit-logs": "audit.view",
    }.get(resource)
    scopes = sources(request, permission) if permission and method == "GET" else []
    domains = [SOURCE_DOMAIN[s] for s in scopes]
    if resource == "dashboard" and method == "GET":
        devices = Device.objects.filter(device_type__in=domains)
        racks = Rack.objects.filter(cabinet__domain__in=domains).select_related(
            "cabinet__device", "rackstatus"
        )
        return JsonResponse(
            dict(
                ipcs=devices.count(),
                online=sum(bool(online(d)) for d in devices),
                cabinet_groups=Cabinet.objects.filter(domain__in=domains).count(),
                racks=racks.count(),
                active_alarms=Alarm.objects.filter(
                    source_type__in=scopes, active=True
                ).count(),
                quantity=(Stock.objects.filter(
                    bin__shelf__rack__cabinet__domain__in=domains
                ).aggregate(n=Sum("quantity"))["n"]
                or 0) if len(domains) == 1 else None,
                quantity_by_source={scope: Stock.objects.filter(bin__shelf__rack__cabinet__domain=SOURCE_DOMAIN[scope]).aggregate(n=Sum('quantity'))['n'] or 0 for scope in scopes},
                environment=[rack_row(r) for r in racks[:200]],
            )
        )
    if resource == "ipcs":
        if method == "GET":
            rows = Device.objects.filter(device_type__in=domains).order_by(
                "device_type", "pk"
            )
            if pk:
                rows = rows.filter(pk=pk)
            return JsonResponse(
                [
                    dict(
                        id=d.pk,
                        name=d.name,
                        source_type=source(d.device_type),
                        enabled=d.enabled,
                        online=bool(online(d)),
                        mqtt_connected=bool(online(d)),
                        serial_connected=d.serial_connected and bool(online(d)),
                        last_seen=d.last_seen,
                        last_sync=d.last_sync,
                        synchronized=d.revision > 0
                        and d.revision == d.acknowledged_revision,
                        cabinet_group_count=d.cabinet_set.count(),
                        cabinet_groups=list(d.cabinet_set.values("id", "name", "code")),
                        racks=Rack.objects.filter(cabinet__device=d).count(),
                    )
                    for d in rows
                ],
                safe=False,
            )
        from .views import devices

        scope = (
            data.get("source_type")
            if method == "POST"
            else source(Device.objects.get(pk=data["device_id"]).device_type)
        )
        require(request.user, "ipc.manage", scope)
        if method == "POST":
            data["device_type"] = SOURCE_DOMAIN[scope]
        import json

        request._body = json.dumps(data).encode()
        return devices.__wrapped__(request)
    if resource in ["cabinet-groups", "rack-status"] and method == "GET":
        if resource == "cabinet-groups":
            rows = Cabinet.objects.filter(domain__in=domains).order_by("domain", "code")
            if request.GET.get("ipc_id"):
                rows = rows.filter(device_id=request.GET["ipc_id"])
            return JsonResponse(
                [
                    dict(
                        id=c.pk,
                        name=c.name,
                        code=c.code,
                        area=c.area,
                        ipc_id=c.device_id,
                        source_type=source(c.domain),
                        configuration_status=c.configuration_status,
                        racks=c.rack_set.count(),
                    )
                    for c in rows
                ],
                safe=False,
            )
        rows = (
            Rack.objects.filter(cabinet__domain__in=domains)
            .select_related("cabinet__device", "rackstatus")
            .order_by("cabinet__domain", "address")
        )
        if request.GET.get("cabinet_id"):
            rows = rows.filter(cabinet_id=request.GET["cabinet_id"])
        if request.GET.get("ipc_id"):
            rows = rows.filter(cabinet__device_id=request.GET["ipc_id"])
        return JsonResponse([rack_row(r) for r in rows], safe=False)
    if resource == "commands" and method == "POST":
        rack = Rack.objects.select_related("cabinet").get(pk=pk)
        scope = source(rack.cabinet.domain)
        require(request.user, "cabinet.control", scope)
        if data["command"] not in ["OPEN", "CLOSE", "VENTILATE"]:
            raise ValueError("Unsupported command")
        with transaction.atomic():
            op = create_operation(
                request.user,
                dict(
                    device_id=rack.cabinet.device_id,
                    rack_id=rack.pk,
                    kind=data["command"],
                    request_key=data.get("request_key", str(uuid4())),
                ),
            )
            audit(
                request.user,
                "cabinet.command",
                "rack",
                pk,
                scope,
                after={"operation_id": str(op.pk), "command": op.kind},
            )
        return JsonResponse({"id": str(op.pk), "state": op.state}, status=201)
    if resource == "environment" and method == "GET":
        rows = EnvironmentStatus.objects.filter(source_type__in=scopes).order_by(
            "-created_at"
        )
        for key, field in [
            ("ipc_id", "device_id"),
            ("cabinet_id", "rack__cabinet_id"),
            ("rack_id", "rack_id"),
        ]:
            if request.GET.get(key):
                rows = rows.filter(**{field: request.GET[key]})
        for key, lookup in [("from", "created_at__gte"), ("to", "created_at__lte")]:
            if request.GET.get(key):
                date = parse_datetime(request.GET[key])
                if not date or timezone.is_naive(date):
                    raise ValueError("Use ISO timestamp with timezone")
                rows = rows.filter(**{lookup: date})
        return JsonResponse(values(rows, request), safe=False)
    if resource == "alarms":
        if method == "GET":
            rows = Alarm.objects.filter(source_type__in=scopes).order_by(
                "source_type", "-active", "-created_at"
            )
            if request.GET.get("active") in ["true", "false"]:
                rows = rows.filter(active=request.GET["active"] == "true")
            return JsonResponse(values(rows, request), safe=False)
        if method == "POST" and pk:
            with transaction.atomic():
                alarm = Alarm.objects.select_for_update().get(pk=pk)
                require(request.user, "alarm.acknowledge", alarm.source_type)
                if not alarm.acknowledged_at:
                    alarm.acknowledged_at, alarm.acknowledged_by = (
                        timezone.now(),
                        request.user,
                    )
                    alarm.save()
                    audit(
                        request.user,
                        "alarm.acknowledge",
                        "alarm",
                        pk,
                        alarm.source_type,
                    )
            return JsonResponse({"id": alarm.pk, "acknowledged": True})
    if resource == "goods":
        if method == "GET":
            result = []
            for item in Item.objects.select_related("category").order_by("code"):
                stocks = item.stock_set.filter(
                    bin__shelf__rack__cabinet__domain__in=domains
                )
                result.append(
                    dict(
                        id=item.pk,
                        code=item.code,
                        name=item.name,
                        unit=item.unit,
                        category_id=item.category_id,
                        category=item.category.name if item.category_id else "",
                        status="active" if item.is_active else "inactive",
                        quantity=sum(s.quantity for s in stocks) if len(domains) == 1 else None,
                        quantity_by_source={scope: sum(s.quantity for s in stocks if source(s.bin.shelf.rack.cabinet.domain) == scope) for scope in scopes},
                        locations=[
                            dict(
                                location_id=s.bin_id,
                                quantity=s.quantity,
                                source_type=source(s.bin.shelf.rack.cabinet.domain),
                            )
                            for s in stocks
                        ],
                    )
                )
            return JsonResponse(result, safe=False)
        # Catalog is shared, so changes require ALL scope.
        require(
            request.user,
            {
                "POST": "inventory.create",
                "PATCH": "inventory.update",
                "DELETE": "inventory.delete",
            }[method],
        )
        from .views import resources

        return resources.__wrapped__(request, "items")
    if resource == "storage-locations":
        if method == "GET":
            rows = (
                Bin.objects.filter(shelf__rack__cabinet__domain__in=domains)
                .select_related("shelf__rack__cabinet")
                .order_by(
                    "shelf__rack__cabinet__domain", "shelf__rack_id", "shelf_id", "code"
                )
            )
            return JsonResponse([location_row(b) for b in rows], safe=False)
        if method == "PATCH":
            with transaction.atomic():
                list(Device.objects.select_for_update().order_by("pk"))
                b = Bin.objects.select_for_update().get(pk=data["id"])
                scope = source(b.shelf.rack.cabinet.domain)
                require(request.user, "inventory.update", scope)
                if type(data.get("reserved")) is not bool:
                    raise ValueError("reserved must be boolean")
                before = {"reserved": b.reserved}
                b.reserved = data["reserved"]
                b.save(update_fields=["reserved"])
                audit(
                    request.user,
                    "location.reserve",
                    "bin",
                    b.pk,
                    scope,
                    before,
                    {"reserved": b.reserved},
                )
            return JsonResponse(location_row(b))
    if resource == "inventory-transactions":
        if method == "GET":
            return JsonResponse(
                values(
                    InventoryTransaction.objects.filter(
                        source_type__in=scopes
                    ).order_by("-pk"),
                    request,
                ),
                safe=False,
            )
        if method == "POST":
            entry = transact(request.user, data)
            return JsonResponse({"id": entry.pk}, status=201)
    if resource == "audit-logs" and method == "GET":
        return JsonResponse(
            values(
                AuditLog.objects.filter(
                    source_type__in=scopes + (["ALL"] if len(scopes) == 2 else [])
                ).order_by("-pk"),
                request,
            ),
            safe=False,
        )
    if resource in ["users", "roles", "permissions", "settings"]:
        if not (
            resource == "roles"
            and method == "GET"
            and allowed(request.user, "user.manage", "ALL")
        ):
            require(
                request.user,
                {
                    "users": "user.view" if method == "GET" else "user.manage",
                    "roles": "role.manage",
                    "permissions": "role.manage",
                    "settings": "system.manage",
                }[resource],
            )
        if method == "GET":
            if resource == "permissions":
                return JsonResponse(PERMISSIONS, safe=False)
            if resource == "users":
                return JsonResponse(
                    [
                        dict(
                            id=u.pk,
                            username=u.username,
                            is_active=u.is_active,
                            roles=list(u.groups.values_list("pk", flat=True)),
                        )
                        for u in User.objects.order_by("pk")
                    ],
                    safe=False,
                )
            if resource == "roles":
                return JsonResponse(
                    [
                        dict(
                            id=g.pk,
                            name=g.name,
                            permissions=list(
                                g.rolepermission_set.values("permission", "scope")
                            ),
                        )
                        for g in Group.objects.order_by("pk")
                    ],
                    safe=False,
                )
            return JsonResponse(
                dict(temperature_max=50, humidity_max=85)
                | dict(SystemSetting.objects.values_list("key", "value"))
            )
        if method not in ["POST", "PATCH"]:
            return JsonResponse({"error": "Method not allowed"}, status=405)
        with transaction.atomic():
            if resource == "users":
                obj = (
                    User.objects.select_for_update().get(pk=data["id"])
                    if method == "PATCH"
                    else User(username=data["username"])
                )
                if obj.is_superuser:
                    raise ValueError("Manage superusers through Django administration")
                before = (
                    {
                        "username": obj.username,
                        "is_active": obj.is_active,
                        "roles": list(obj.groups.values_list("pk", flat=True)),
                    }
                    if obj.pk
                    else {}
                )
                if "is_active" in data:
                    if type(data["is_active"]) is not bool:
                        raise ValueError("is_active must be boolean")
                    if obj == request.user and not data["is_active"]:
                        raise ValueError("Cannot deactivate yourself")
                    obj.is_active = data["is_active"]
                if data.get("password"):
                    validate_password(data["password"], obj)
                    obj.set_password(data["password"])
                elif method == "POST":
                    raise ValueError("Password required")
                obj.full_clean()
                obj.save()
                if "roles" in data:
                    roles = list(Group.objects.filter(pk__in=data["roles"]))
                    if len(roles) != len(set(data["roles"])):
                        raise ValueError("Unknown role")
                    obj.groups.set(roles)
                after = {
                    "username": obj.username,
                    "is_active": obj.is_active,
                    "roles": list(obj.groups.values_list("pk", flat=True)),
                }
            elif resource == "roles":
                obj = (
                    Group.objects.select_for_update().get(pk=data["id"])
                    if method == "PATCH"
                    else Group()
                )
                before = (
                    {
                        "name": obj.name,
                        "permissions": list(
                            obj.rolepermission_set.values("permission", "scope")
                        ),
                    }
                    if obj.pk
                    else {}
                )
                obj.name = data["name"]
                obj.full_clean()
                obj.save()
                if "permissions" in data:
                    obj.rolepermission_set.all().delete()
                    for p in data["permissions"]:
                        if p["permission"] not in PERMISSIONS or p["scope"] not in [
                            "REAL",
                            "SIMULATION",
                            "ALL",
                        ]:
                            raise ValueError("Invalid permission or scope")
                        RolePermission.objects.get_or_create(role=obj, **p)
                after = {"name": obj.name, "permissions": data.get("permissions", [])}
            elif resource == "settings":
                import math

                if (
                    data.get("key") not in ["temperature_max", "humidity_max"]
                    or type(data.get("value")) not in [int, float]
                    or not math.isfinite(data["value"])
                ):
                    raise ValueError("Invalid threshold")
                if (
                    not 0
                    <= data["value"]
                    <= (100 if data["key"] == "humidity_max" else 200)
                ):
                    raise ValueError("Threshold outside allowed range")
                old = SystemSetting.objects.filter(pk=data["key"]).first()
                before = {"value": old.value} if old else {}
                obj, _ = SystemSetting.objects.update_or_create(
                    key=data["key"], defaults={"value": data["value"]}
                )
                after = data
            else:
                return JsonResponse({"error": "Method not allowed"}, status=405)
            audit(
                request.user,
                method.lower(),
                resource,
                obj.pk,
                before=before,
                after=after,
            )
        return JsonResponse({"id": obj.pk}, status=201 if method == "POST" else 200)
    return JsonResponse({"error": "Method not allowed"}, status=405)
