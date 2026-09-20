import json
import secrets
from functools import wraps
from django.contrib.auth import authenticate, login, logout
from django.db import transaction, IntegrityError
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from ipc_core.protocol import valid_id
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger, RuntimeEvent, Category, AuditLog
from django.forms.models import model_to_dict
from .services import assign, refresh, create_operation, confirm_operation, online


def api(permission=None):
    def decorate(fn):
        @wraps(fn)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"error": "Authentication required"}, status=401)
            if permission and not request.user.has_perm(permission):
                return JsonResponse({"error": "Permission denied"}, status=403)
            try:
                return fn(request, *args, **kwargs)
            except ObjectDoesNotExist:
                return JsonResponse({"error": "Not found or outside scope"}, status=404)
            except (ValueError, KeyError, TypeError, IntegrityError, ValidationError) as exc:
                return JsonResponse({"error": str(exc)}, status=400)
        return wrapped
    return decorate


def body(request):
    value = json.loads(request.body or b"{}")
    if not isinstance(value, dict):
        raise ValueError("JSON body must be an object")
    return value


@ensure_csrf_cookie
def session(request):
    if request.method not in {"GET", "POST", "DELETE"}:
        return JsonResponse({"error": "Method not allowed"}, status=405)
    if request.method == "POST":
        try:
            data = body(request)
        except (ValueError, TypeError):
            return JsonResponse({"error": "Invalid JSON body"}, status=400)
        user = authenticate(request, username=data.get("username"), password=data.get("password"))
        if user is None:
            return JsonResponse({"error": "Invalid credentials"}, status=401)
        login(request, user)
    elif request.method == "DELETE":
        logout(request)
    return JsonResponse({"authenticated": request.user.is_authenticated, "username": request.user.get_username(),
                         "permissions": sorted(request.user.get_all_permissions()) if request.user.is_authenticated else []})


@api("inventory.view_device")
def devices(request):
    if request.method == "GET":
        return JsonResponse([dict(device_id=d.pk, device_type=d.device_type, name=d.name,
            enabled=d.enabled, online=bool(online(d)), last_seen=d.last_seen,
            serial_connected=d.serial_connected and bool(online(d)),
            revision=d.revision, acknowledged_revision=d.acknowledged_revision) for d in Device.objects.order_by("pk")], safe=False)
    if request.method == "PATCH" and request.user.has_perm("inventory.change_device"):
        data = body(request)
        if type(data.get("enabled")) is not bool:
            raise ValueError("enabled must be boolean")
        with transaction.atomic():
            device = Device.objects.select_for_update().get(pk=data["device_id"])
            if Operation.objects.filter(device=device).exclude(state__in=["confirmed", "failed", "cancelled"]).exists():
                raise ValueError("Resolve pending operations before changing device status")
            device.enabled = data["enabled"]
            device.name = data.get("name", device.name)
            device.last_seen = None
            device.save(update_fields=["enabled", "name", "last_seen"])
            AuditLog.objects.create(actor=request.user, action='update', resource='device', object_id=device.pk,
                                    after={'enabled': device.enabled, 'name': device.name})
        return JsonResponse({"device_id": device.pk, "enabled": device.enabled})
    if request.method != "POST" or not request.user.has_perm("inventory.add_device"):
        return JsonResponse({"error": "Permission denied"}, status=403)
    data = body(request)
    if not valid_id(data["device_id"]) or data["device_id"] == "inventory-server" or data["device_type"] not in {"IPC", "IPCSIM"}:
        raise ValueError("Invalid identity")
    secret = secrets.token_urlsafe(48)
    with transaction.atomic():
        device = Device.objects.create(device_id=data["device_id"], device_type=data["device_type"], name=data["name"], secret=secret)
        refresh(device, full=True)
        AuditLog.objects.create(actor=request.user, action='create', resource='device', object_id=device.pk,
                                after={'name': device.name, 'device_type': device.device_type})
    return JsonResponse({"device_id": device.pk, "device_secret": secret}, status=201)


@api("inventory.change_cabinet")
def assignments(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    data = body(request)
    with transaction.atomic():
        assign(data["cabinet_id"], data.get("device_id"))
        AuditLog.objects.create(actor=request.user, action='assign', resource='cabinet', object_id=str(data['cabinet_id']), after=data)
    return JsonResponse({"status": "assigned"})


RESOURCES = {
    "cabinets": (Cabinet, {"code", "name", "domain", "group", "description"}),
    "racks": (Rack, {"cabinet_id", "address", "name"}),
    "shelves": (Shelf, {"rack_id", "code", "level"}),
    "bins": (Bin, {"shelf_id", "code", "capacity"}),
    "items": (Item, {"code", "name", "unit", "min_qty", "max_qty", "category_id", "description", "is_active"}),
    "categories": (Category, {'code', 'name', 'description'}),
}


@api()
def resources(request, resource):
    model, fields = RESOURCES[resource]
    action = {"GET":"view", "POST":"add", "DELETE":"delete"}.get(request.method, "change")
    if not request.user.has_perm(f"inventory.{action}_{model._meta.model_name}"):
        return JsonResponse({"error": "Permission denied"}, status=403)
    if request.method == "GET":
        return JsonResponse(list(model.objects.order_by("pk").values()), safe=False)
    if request.method not in {"POST", "PATCH", "DELETE"}:
        return JsonResponse({"error": "Use POST, PATCH or DELETE"}, status=405)
    data = body(request)
    with transaction.atomic():
        devices = list(Device.objects.select_for_update().order_by("pk"))
        if request.method == "DELETE":
            obj = model.objects.get(pk=data["id"])
            if isinstance(obj, Cabinet) and obj.topology_locked or isinstance(obj, Rack) and obj.cabinet.topology_locked:
                raise ValueError('Bootstrap topology is locked; mapping cannot be deleted')
            before = model_to_dict(obj)
            obj.delete()  # PROTECT preserves locations referenced by stock/history.
            AuditLog.objects.create(actor=request.user, action='delete', resource=resource, object_id=str(data['id']), before=before)
            for device in devices:
                refresh(device, full=True)
            return JsonResponse({"status":"deleted"})
        values = {k: v for k, v in data.items() if k in fields}
        if 'is_active' in values and type(values['is_active']) is not bool:
            raise ValueError('is_active must be boolean')
        if request.method == "PATCH":
            obj = model.objects.get(pk=data["id"])
            before = model_to_dict(obj)
            if isinstance(obj, Cabinet) and obj.topology_locked and any(k in values and values[k] != getattr(obj, k) for k in ('code', 'group')):
                raise ValueError('Cabinet logical ID is locked by bootstrap mapping')
            # Physical topology is immutable once created; assignments have a dedicated service.
            immutable = {"domain", "cabinet_id", "rack_id", "shelf_id", "address"}
            if any(k in immutable and getattr(obj, k) != v for k, v in values.items()):
                raise ValueError("Create a new location for topology changes")
            for k, v in values.items():
                setattr(obj, k, v)
        else:
            obj = model(**values)
            before = {}
            if isinstance(obj, Rack) and obj.cabinet.topology_locked:
                raise ValueError('Rack mapping is locked; unknown Hardware must be specified before configuration')
        obj.full_clean()
        if isinstance(obj, Rack) and obj.cabinet.device_id:
            if Rack.objects.filter(cabinet__device_id=obj.cabinet.device_id, address=obj.address).exclude(pk=obj.pk).exists():
                raise ValueError("Serial address already used by this device")
        obj.save()
        AuditLog.objects.create(actor=request.user, action=request.method.lower(), resource=resource,
                                object_id=str(obj.pk), before=before, after=model_to_dict(obj))
        for device in devices:
            refresh(device)
    return JsonResponse({"id": obj.pk}, status=201 if request.method == "POST" else 200)


@api("inventory.view_stock")
def inventory(request):
    domain = request.GET.get("domain", "IPC")
    if domain not in {"IPC", "IPCSIM"}:
        raise ValueError("Invalid domain")
    rows = Stock.objects.filter(bin__shelf__rack__cabinet__domain=domain).values(
        "id", "item_id", "item__code", "item__name", "bin_id", "bin__code", "quantity", "bin__shelf__rack__cabinet__domain")
    return JsonResponse(list(rows), safe=False)


@api("inventory.view_operation")
def operations(request):
    if request.method == "GET":
        rows = Operation.objects.order_by('-created_at')
        if request.GET.get('device_id'):
            rows = rows.filter(device_id=request.GET['device_id'])
        return JsonResponse(list(rows.values()[:200]), safe=False)
    if request.method != "POST" or not request.user.has_perm("inventory.add_operation"):
        return JsonResponse({"error": "Permission denied"}, status=403)
    op = create_operation(request.user, body(request))
    return JsonResponse({"id": str(op.pk), "state": op.state}, status=201)


@api("inventory.change_operation")
def confirm(request, operation_id):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    data = body(request)
    if type(data.get("success", True)) is not bool:
        raise ValueError("success must be boolean")
    op = confirm_operation(request.user, operation_id, data.get("note", ""), data.get("success", True))
    return JsonResponse({"id": str(op.pk), "state": op.state})


@api("inventory.view_ledger")
def ledger(request):
    return JsonResponse(list(Ledger.objects.order_by("-pk").values()[:500]), safe=False)


@api("inventory.view_runtimeevent")
def events(request):
    rows = RuntimeEvent.objects.order_by("-pk")
    if request.GET.get("device_id"):
        rows = rows.filter(device_id=request.GET["device_id"])
    return JsonResponse(list(rows.values()[:200]), safe=False)


@api('inventory.view_auditlog')
def audit(request):
    return JsonResponse(list(AuditLog.objects.order_by('-pk').values()[:300]), safe=False)
