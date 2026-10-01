import json
from functools import wraps
from django.contrib.auth import authenticate, login, logout
from django.db import transaction, IntegrityError
from django.core.exceptions import ObjectDoesNotExist, ValidationError, PermissionDenied
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from ipc_core.protocol import valid_id
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger, RuntimeEvent, Category, AuditLog
from django.forms.models import model_to_dict
from .services import assign, refresh, create_operation, confirm_operation, online
from .permissions import require, sources, source, SOURCE_DOMAIN, PERMISSIONS, allowed


def api():
    def decorate(fn):
        @wraps(fn)
        def wrapped(request, *args, **kwargs):
            if not request.user.is_authenticated:
                return JsonResponse({"error": "Authentication required"}, status=401)
            try:
                return fn(request, *args, **kwargs)
            except PermissionDenied as exc:
                AuditLog.objects.create(actor=request.user, action="access.denied", resource=request.path[:64], object_id="", result="denied")
                return JsonResponse({"error": str(exc)}, status=403)
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
            AuditLog.objects.create(action="login", resource="session", object_id=str(data.get("username", ""))[:64], result="denied")
            return JsonResponse({"error": "Invalid credentials"}, status=401)
        login(request, user)
        AuditLog.objects.create(actor=user, action="login", resource="session", object_id=str(user.pk))
    elif request.method == "DELETE":
        logout(request)
    return JsonResponse({"authenticated": request.user.is_authenticated, "username": request.user.get_username(),
                         "permissions": sorted(request.user.get_all_permissions()) if request.user.is_authenticated else [],
                         "grants": {p: [s for s in ["REAL", "SIMULATION", "ALL"] if allowed(request.user, p, s)] for p in PERMISSIONS} if request.user.is_authenticated else {}})


@api()
def devices(request):
    if request.method == "GET":
        domains = [SOURCE_DOMAIN[s] for s in sources(request, "ipc.view")]
        return JsonResponse([dict(device_id=d.pk, device_type=d.device_type, name=d.name,
            enabled=d.enabled, online=bool(online(d)), last_seen=d.last_seen,
            serial_connected=d.serial_connected and bool(online(d)),
            revision=d.revision, acknowledged_revision=d.acknowledged_revision) for d in Device.objects.filter(device_type__in=domains).order_by("pk")], safe=False)
    if request.method == "PATCH":
        data = body(request)
        if type(data.get("enabled")) is not bool:
            raise ValueError("enabled must be boolean")
        with transaction.atomic():
            device = Device.objects.select_for_update().get(pk=data["device_id"])
            require(request.user, "ipc.manage", source(device.device_type))
            if Operation.objects.filter(device=device).exclude(state__in=["confirmed", "failed", "cancelled"]).exists():
                raise ValueError("Resolve pending operations before changing device status")
            device.enabled = data["enabled"]
            device.name = data.get("name", device.name)
            device.last_seen = None
            device.save(update_fields=["enabled", "name", "last_seen"])
            AuditLog.objects.create(actor=request.user, action='update', resource='device', object_id=device.pk,
                                    after={'enabled': device.enabled, 'name': device.name}, source_type=source(device.device_type))
        return JsonResponse({"device_id": device.pk, "enabled": device.enabled})
    if request.method != "POST":
        return JsonResponse({"error": "Permission denied"}, status=403)
    data = body(request)
    if not valid_id(data["device_id"]) or data["device_id"] == "inventory-server" or data["device_type"] not in {"IPC", "IPCSIM"}:
        raise ValueError("Invalid identity")
    require(request.user, "ipc.manage", source(data["device_type"]))
    with transaction.atomic():
        device = Device.objects.create(device_id=data["device_id"], device_type=data["device_type"], name=data["name"])
        refresh(device, full=True)
        AuditLog.objects.create(actor=request.user, action='create', resource='device', object_id=device.pk,
                                after={'name': device.name, 'device_type': device.device_type}, source_type=source(device.device_type))
    return JsonResponse({"device_id": device.pk}, status=201)


@api()
def assignments(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    data = body(request)
    with transaction.atomic():
        require(request.user, "ipc.manage", source(Cabinet.objects.get(pk=data["cabinet_id"]).domain))
        assign(data["cabinet_id"], data.get("device_id"))
        AuditLog.objects.create(actor=request.user, action='assign', resource='cabinet', object_id=str(data['cabinet_id']), after=data, source_type=source(Cabinet.objects.get(pk=data['cabinet_id']).domain))
    return JsonResponse({"status": "assigned"})


RESOURCES = {
    "cabinets": (Cabinet, {"code", "name", "domain", "group", "description", "area"}),
    "racks": (Rack, {"cabinet_id", "address", "name"}),
    "shelves": (Shelf, {"rack_id", "code", "level"}),
    "bins": (Bin, {"shelf_id", "code", "capacity"}),
    "items": (Item, {"code", "barcode", "name", "unit", "min_qty", "max_qty", "category_id", "description", "is_active"}),
    "categories": (Category, {'code', 'name', 'description'}),
}


@api()
def resources(request, resource):
    model, fields = RESOURCES[resource]
    action = {"GET":"view", "POST":"add", "DELETE":"delete"}.get(request.method, "change")
    catalog = resource in ['items', 'categories']
    permission = ('inventory.view' if action == 'view' else {'add':'inventory.create','change':'inventory.update','delete':'inventory.delete'}[action]) if catalog or resource in ['bins','shelves'] else ('cabinet.view' if action == 'view' else 'ipc.manage')
    paths = {Cabinet:'domain', Rack:'cabinet__domain', Shelf:'rack__cabinet__domain', Bin:'shelf__rack__cabinet__domain'}
    if request.method == "GET":
        if resource == "racks":
            from .console import console
            return console.__wrapped__(request, "rack-status")
        domains = [SOURCE_DOMAIN[s] for s in sources(request, permission)]
        rows = model.objects.order_by('pk')
        if not catalog: rows = rows.filter(**{paths[model]+'__in':domains})
        return JsonResponse(list(rows.values()), safe=False)
    if request.method not in {"POST", "PATCH", "DELETE"}:
        return JsonResponse({"error": "Use POST, PATCH or DELETE"}, status=405)
    data = body(request)
    with transaction.atomic():
        devices = list(Device.objects.select_for_update().order_by("pk"))
        if catalog:
            require(request.user, permission)
        else:
            target = model.objects.get(pk=data['id']) if request.method in ['PATCH', 'DELETE'] else model(**{k:v for k,v in data.items() if k in fields})
            domain = target.domain if isinstance(target, Cabinet) else target.cabinet.domain if isinstance(target, Rack) else target.rack.cabinet.domain if isinstance(target, Shelf) else target.shelf.rack.cabinet.domain
            require(request.user, permission, source(domain))
        if request.method == "DELETE":
            obj = model.objects.get(pk=data["id"])
            if isinstance(obj, Cabinet) and obj.topology_locked or isinstance(obj, Rack) and obj.cabinet.topology_locked:
                raise ValueError('Bootstrap topology is locked; mapping cannot be deleted')
            before = model_to_dict(obj)
            obj.delete()  # PROTECT preserves locations referenced by stock/history.
            AuditLog.objects.create(actor=request.user, action='delete', resource=resource, object_id=str(data['id']), before=before, source_type='ALL' if catalog else source(domain))
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
                                object_id=str(obj.pk), before=before, after=model_to_dict(obj), source_type="ALL" if catalog else source(domain))
        for device in devices:
            refresh(device)
    return JsonResponse({"id": obj.pk}, status=201 if request.method == "POST" else 200)


@api()
def inventory(request):
    domain = request.GET.get("domain", "IPC")
    if domain not in {"IPC", "IPCSIM"}:
        raise ValueError("Invalid domain")
    require(request.user, "inventory.view", source(domain))
    rows = Stock.objects.filter(bin__shelf__rack__cabinet__domain=domain).values(
        "id", "item_id", "item__code", "item__name", "bin_id", "bin__code", "quantity", "bin__shelf__rack__cabinet__domain")
    return JsonResponse(list(rows), safe=False)


@api()
def operations(request):
    if request.method == "GET":
        # Existing edge gateway specifies device_id, not a global UI filter.
        if request.GET.get('device_id') and not request.GET.get('source_type'):
            request.GET = request.GET.copy()
            request.GET['source_type'] = source(Device.objects.get(pk=request.GET['device_id']).device_type)
        domains = [SOURCE_DOMAIN[s] for s in sources(request, "cabinet.view")]
        rows = Operation.objects.filter(device__device_type__in=domains).order_by('-created_at')
        if request.GET.get('device_id'):
            rows = rows.filter(device_id=request.GET['device_id'])
        return JsonResponse([{**row, "source_type":source(row.pop("device__device_type"))} for row in rows.values("id", "device_id", "device__device_type", "rack_id", "kind", "quantity", "state", "execution_state", "created_at")[:200]], safe=False)
    if request.method != "POST":
        return JsonResponse({"error": "Permission denied"}, status=403)
    if not any(allowed(request.user, p, s) for p in ["cabinet.control", "inventory.move"] for s in ["REAL", "SIMULATION"]):
        raise PermissionDenied("Permission denied")
    op = create_operation(request.user, body(request))
    return JsonResponse({"id": str(op.pk), "state": op.state}, status=201)


@api()
def confirm(request, operation_id):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=405)
    data = body(request)
    if type(data.get("success", True)) is not bool:
        raise ValueError("success must be boolean")
    op = confirm_operation(request.user, operation_id, data.get("note", ""), data.get("success", True))
    return JsonResponse({"id": str(op.pk), "state": op.state})


@api()
def ledger(request):
    domains = [SOURCE_DOMAIN[s] for s in sources(request, "inventory.view")]
    return JsonResponse(list(Ledger.objects.filter(operation__device__device_type__in=domains).order_by("-pk").values()[:500]), safe=False)


@api()
def events(request):
    domains = [SOURCE_DOMAIN[s] for s in sources(request, "environment.view")]
    rows = RuntimeEvent.objects.filter(device__device_type__in=domains).order_by("-pk")
    if request.GET.get("device_id"):
        rows = rows.filter(device_id=request.GET["device_id"])
    return JsonResponse(list(rows.values()[:200]), safe=False)


@api()
def audit(request):
    scopes = sources(request, 'audit.view')
    return JsonResponse(list(AuditLog.objects.filter(source_type__in=scopes + (['ALL'] if len(scopes)==2 else [])).order_by('-pk').values()[:300]), safe=False)
