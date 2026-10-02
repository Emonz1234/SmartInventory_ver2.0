"""Read-only inventory projection. Quantities are always grouped by source."""
from collections import defaultdict
from django.http import JsonResponse
from django.db.models import Q
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from django.contrib.auth import get_user_model
from .models import Bin, Stock, Item, Device, Operation, InventoryTransaction, PhysicalTransaction
from .location import location_fields
from .permissions import sources, source, SOURCE_DOMAIN
from .services import online
from .views import api


def sync_status(device):
    return 'Synced' if device and device.revision > 0 and device.revision == device.acknowledged_revision else 'Pending'


def projection(scopes):
    domains = [SOURCE_DOMAIN[s] for s in scopes]
    devices = list(Device.objects.filter(device_type__in=domains).order_by('device_type', 'pk'))
    stocks = defaultdict(list)
    for stock in Stock.objects.select_related('item').filter(bin__shelf__rack__cabinet__domain__in=domains):
        stocks[stock.bin_id].append(stock)
    busy = set(Operation.objects.exclude(state__in=['confirmed', 'failed', 'cancelled']).values_list('rack_id', flat=True))
    locations = []
    conflicts = {str(p.payload.get('location_id')) for p in PhysicalTransaction.objects.filter(device__device_type__in=domains, status='CONFLICT')}
    for b in Bin.objects.filter(shelf__rack__cabinet__domain__in=domains).select_related('shelf__rack__cabinet__device', 'shelf__rack__rackstatus'):
        r, c = b.shelf.rack, b.shelf.rack.cabinet
        telemetry = getattr(r, 'rackstatus', None)
        v = telemetry.values if telemetry else {}
        quantity = sum(s.quantity for s in stocks[b.pk])
        fault = v.get('fault') or str(v.get('status', '')).upper() == 'FAULT' or any(v.get(k) for k in ['is_obstructed', 'is_skewed', 'is_overload_motor', 'smoke'])
        status = 'FAULT' if fault else 'BUSY' if b.reserved or r.pk in busy or v.get('is_hard_locked') or str(v.get('status', '')).upper() == 'BUSY' else 'FULL' if b.capacity and quantity >= b.capacity else 'EMPTY' if quantity == 0 else 'AVAILABLE'
        locations.append(dict(**location_fields(r), id=b.pk, ipc_id=c.device_id, cabinet_id=c.pk, cabinet=c.name, rack_id=r.pk,
            rack=r.name or str(r.address), location_code=b.code, shelf=b.shelf.code,
            path=f'{c.device_id or "Unassigned"} / Cabinet {c.cabinet_index:02d} / Rack {r.rack_index:02d}',
            source_type=source(c.domain), capacity=b.capacity, quantity=quantity, status=status,
            sync_status='Failed' if str(b.pk) in conflicts else sync_status(c.device), last_updated=max((s.updated_at for s in stocks[b.pk]), default=telemetry.updated_at if telemetry else None),
            goods=[dict(item_id=s.item_id, name=s.item.name, quantity=s.quantity,
                        available_quantity=0 if status in ['FAULT', 'BUSY'] else s.quantity) for s in stocks[b.pk]]))
    products = []
    for item in Item.objects.select_related('category').order_by('name'):
        for scope in scopes:
            places = [dict(l, quantity=g['quantity'], occupied_quantity=l['quantity'], available_quantity=g['available_quantity'])
                      for l in locations if l['source_type'] == scope for g in l['goods'] if g['item_id'] == item.pk]
            # Unallocated catalog items appear as zero stock, separately in each authorized source.
            quantity = sum(l['quantity'] for l in places)
            products.append(dict(id=item.pk, source_type=scope, name=item.name, sku=item.code, barcode=item.barcode,
                category=item.category.name if item.category else 'Uncategorized', category_id=item.category_id, is_active=item.is_active, description=item.description, unit=item.unit, min_stock=item.min_qty,
                max_stock=item.max_qty, quantity=quantity, available_quantity=sum(l['available_quantity'] for l in places),
                locations=places, stock_status='Out of Stock' if quantity == 0 else 'Low Stock' if quantity < item.min_qty else 'Normal',
                sync_status='Failed' if any(l['sync_status'] == 'Failed' for l in places) else 'Pending' if any(l['sync_status'] == 'Pending' for l in places) else 'Synced',
                last_updated=max((l['last_updated'] for l in places if l['last_updated']), default=None)))
    return products, locations, devices


def history(scopes, item_id=None, offset=0, limit=500):
    rows = []
    entries = InventoryTransaction.objects.filter(source_type__in=scopes).select_related('actor', 'item', 'operation', 'from_location__shelf__rack__cabinet__device', 'to_location__shelf__rack__cabinet__device')
    operations = Operation.objects.filter(device__device_type__in=[SOURCE_DOMAIN[s] for s in scopes], item__isnull=False).select_related('device', 'item', 'rack__cabinet', 'requested_by', 'bin').filter(inventorytransaction__isnull=True)
    if item_id:
        entries, operations = entries.filter(item_id=item_id), operations.filter(item_id=item_id)
    for t in entries.order_by('-created_at', '-pk')[:offset+limit]:
        b = t.to_location or t.from_location
        c = b.shelf.rack.cabinet
        op = t.operation
        rows.append(dict(**location_fields(b.shelf.rack), _order=(0,t.pk), id=t.request_key, item_id=t.item_id, product=t.item.name, kind={'INBOUND':'PUT', 'OUTBOUND':'PICK', 'ADJUST':'ADJUSTMENT'}.get(t.kind,t.kind),
            quantity=t.quantity, user=t.actor.username, ipc_id=c.device_id, cabinet=c.name, rack=b.shelf.rack.name,
            source_type=t.source_type, operation_status='COMPLETED' if not op or op.state == 'confirmed' else op.state.upper(),
            sync_status=sync_status(c.device), created_at=t.created_at, completed_at=(op.execution_updated_at if op else t.created_at), reason=t.note))
    for op in operations.order_by('-created_at', '-pk')[:offset+limit]:
        rows.append(dict(**location_fields(op.rack), _order=(1,op.pk.int), id=op.request_key, item_id=op.item_id, product=op.item.name, kind=op.kind, quantity=op.quantity,
            user=op.requested_by.username, ipc_id=op.device_id, cabinet=op.rack.cabinet.name, rack=op.rack.name,
            source_type=source(op.device.device_type), operation_status='COMPLETED' if op.state == 'confirmed' else op.state.upper(),
            sync_status=sync_status(op.device), created_at=op.created_at,
            completed_at=op.execution_updated_at if op.state in ['confirmed','failed','cancelled'] else None, reason=op.confirmation_note))
    pending = PhysicalTransaction.objects.filter(device__device_type__in=[SOURCE_DOMAIN[s] for s in scopes]).exclude(status='APPLIED').select_related('device')
    if item_id:
        pending = pending.filter(payload__product_id=int(item_id))
    for p in pending.order_by('-received_at', '-pk')[:offset+limit]:
        payload = p.payload
        try:
            item = Item.objects.get(pk=payload.get('product_id'))
            b = Bin.objects.select_related('shelf__rack__cabinet').get(pk=payload.get('location_id'), shelf__rack__cabinet__device=p.device)
        except (ValueError, TypeError, Item.DoesNotExist, Bin.DoesNotExist):
            continue
        actor = get_user_model().objects.filter(pk=payload.get('user_id')).first()
        completed = parse_datetime(str(payload.get('completed_at', '')))
        rows.append(dict(_order=(2,p.pk.int), id=str(p.pk), item_id=item.pk, product=item.name, kind=payload.get('operation_type'), quantity=payload.get('quantity'),
            user=actor.username if actor else 'Unknown', ipc_id=p.device_id, cabinet=b.shelf.rack.cabinet.name, rack=b.shelf.rack.name,
            source_type=source(p.device.device_type), operation_status='COMPLETED', sync_status='Failed' if p.status=='CONFLICT' else 'Pending',
            created_at=p.received_at, completed_at=completed if completed and timezone.is_aware(completed) else None,
            reason=p.error or 'Awaiting reconciliation'))
    result = sorted(rows, key=lambda r:(r['created_at'],r['_order']), reverse=True)[offset:offset+limit]
    for row in result:
        row.pop('_order')
    return result


@api()
def overview(request):
    if request.method != 'GET':
        return JsonResponse({'error':'Method not allowed'}, status=405)
    scopes = sources(request, 'inventory.view')
    if request.GET.get('item_id'):
        item_id = int(request.GET['item_id'])
        offset = int(request.GET.get('offset', 0))
        if offset < 0:
            raise ValueError('offset must be nonnegative')
        return JsonResponse(dict(transactions=history(scopes, item_id, offset, 100)))
    products, locations, devices = projection(scopes)
    pending_ids = [d.pk for d in devices if sync_status(d) == 'Pending']
    pending_count = InventoryTransaction.objects.filter(source_type__in=scopes).filter(Q(from_location__shelf__rack__cabinet__device_id__in=pending_ids) | Q(to_location__shelf__rack__cabinet__device_id__in=pending_ids)).count()
    pending_count += Operation.objects.filter(device_id__in=pending_ids, item__isnull=False, inventorytransaction__isnull=True).count()
    pending_count += PhysicalTransaction.objects.filter(device__device_type__in=[SOURCE_DOMAIN[s] for s in scopes], status='PENDING').count()
    return JsonResponse(dict(products=products, locations=locations, transactions=history(scopes),
        pending_sync=pending_count,
        devices=[dict(id=d.pk, name=d.name, source_type=source(d.device_type), online=bool(online(d))) for d in devices],
        sync_note='Sync reflects the current IPC dataset acknowledgement; it is not a per-transaction delivery receipt.'))
