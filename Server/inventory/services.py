from datetime import timedelta
from uuid import uuid4, uuid5, NAMESPACE_URL
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from ipc_core.protocol import envelope, checksum, valid_id
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger, Outbox


def queue(device, channel, kind, payload, **metadata):
    if channel == 'ack' and metadata.get('correlation_id'):
        # Reuse the same durable ACK even after a replay following a lost delivery.
        ack_id = uuid5(NAMESPACE_URL, f'inventory/ack/{device.pk}/{kind}/{metadata["correlation_id"]}')
        message = envelope(device.pk, device.device_type, kind, payload, **metadata)
        message['message_id'] = str(ack_id)
        pending, created = Outbox.objects.get_or_create(id=ack_id,
            defaults={'device': device, 'channel': channel, 'body': message})
        if not created and pending.acknowledged:
            Outbox.objects.filter(pk=ack_id).update(acknowledged=False, sent_at=None, body=message)
            pending.body = message
        return pending.body
    if kind == 'status.lease':
        Outbox.objects.filter(device=device, channel=channel, acknowledged=False,
            body__message_type=kind).update(acknowledged=True)
    message = envelope(device.pk, device.device_type, kind, payload, **metadata)
    Outbox.objects.create(id=message["message_id"], device=device, channel=channel, body=message)
    return message


def records_for(device):
    records = []
    from .offline import auth_records
    records.extend(auth_records(device))
    records.append({'key': 'device:config', 'kind': 'device_config', 'domain': device.device_type,
                    'data': {'device_id': device.pk, 'device_type': device.device_type, 'enabled': device.enabled,
                             'offline_protocol': 1}})
    def add(kind, key, data, domain=None):
        records.append(dict(key=f"{kind}:{key}", kind=kind, data=data, **({"domain": domain} if domain else {})))
    for item in Item.objects.order_by("pk"):
        add("item", item.pk, dict(id=item.pk, item_code=item.code, item_name=item.name, unit=item.unit,
                                  min_qty=item.min_qty, max_qty=item.max_qty, description=item.description,
                                  category=item.category.name if item.category_id else '',
                                  is_active=item.is_active, is_demo=item.is_demo))
    cabinets = Cabinet.objects.filter(device=device, domain=device.device_type)
    for c in cabinets:
        add("cabinet", c.pk, dict(id=c.pk, cabinet_code=c.code, cabinet_name=c.name,
            status=c.configuration_status, description=c.description, cabinet_index=c.cabinet_index,
            device_code=c.device_id, device_type="REAL" if c.domain == "IPC" else "SIMULATION"), c.domain)
    for r in Rack.objects.filter(cabinet__in=cabinets):
        add("rack", r.pk, dict(id=r.pk, cabinet_id=r.cabinet_id, rack_code=str(r.address), rack_name=r.name, rack_index=r.rack_index,
            rack_identity_code=r.code), device.device_type)
    for s in Shelf.objects.filter(rack__cabinet__in=cabinets):
        add("shelf", s.pk, dict(id=s.pk, rack_id=s.rack_id, shelf_code=s.code, level_no=s.level), device.device_type)
    for b in Bin.objects.filter(shelf__rack__cabinet__in=cabinets):
        add("bin", b.pk, dict(id=b.pk, shelf_id=b.shelf_id, bin_code=b.code, capacity=b.capacity), device.device_type)
    for s in Stock.objects.filter(bin__shelf__rack__cabinet__in=cabinets):
        add("stock", s.pk, dict(id=s.pk, item_id=s.item_id, bin_id=s.bin_id, quantity=s.quantity), device.device_type)
    return sorted(records, key=lambda r: r["key"])


def full_snapshot(device, records=None):
    records = device.snapshot if records is None else records
    batches = [records[i:i+200] for i in range(0, len(records), 200)] or [[]]
    sync_id, digest = str(uuid4()), checksum(records)
    for index, batch in enumerate(batches):
        queue(device, "sync", "sync.full", {"index": index, "count": len(batches), "digest": digest, "records": batch},
              sync_id=sync_id, dataset_id=device.pk, revision=device.revision)


def refresh(device, full=False):
    """Caller holds the device lock; every master-data writer locks devices first."""
    records = records_for(device)
    if records == device.snapshot and device.revision and not full:
        return
    before = {r["key"]: r for r in device.snapshot}
    base = device.revision
    device.revision += 1
    device.snapshot = records
    device.save(update_fields=["revision", "snapshot"])
    if full or base == 0:
        full_snapshot(device)
    else:
        after = {r["key"]: r for r in records}
        changes = {"records": [r for r in records if before.get(r["key"]) != r], "deleted": sorted(set(before)-set(after))}
        queue(device, "sync", "sync.delta", dict(**changes, base_revision=base, digest=checksum(changes)),
              dataset_id=device.pk, revision=device.revision)


@transaction.atomic
def assign(cabinet_id, device_id):
    devices = list(Device.objects.select_for_update().order_by("pk"))
    cabinet = Cabinet.objects.select_for_update().get(pk=cabinet_id)
    target = next((d for d in devices if d.pk == device_id), None) if device_id else None
    if device_id and (target is None or not target.enabled or target.device_type != cabinet.domain):
        raise ValueError("Assignment crosses domain or invalid device")
    if Operation.objects.filter(rack__cabinet=cabinet).exclude(state__in=["confirmed", "failed", "cancelled"]).exists():
        raise ValueError("Resolve pending operations before reassignment")
    if target:
        if Cabinet.objects.filter(device=target, cabinet_index=cabinet.cabinet_index).exclude(pk=cabinet.pk).exists():
            raise ValueError("Cabinet index already used by target device")
        if not 1 <= cabinet.cabinet_index <= (1 if target.device_type == "IPC" else 22):
            raise ValueError("Cabinet index outside target device topology")
        addresses = Rack.objects.filter(cabinet=cabinet).values_list("address", flat=True)
        if Rack.objects.filter(cabinet__device=target, address__in=addresses).exclude(cabinet=cabinet).exists():
            raise ValueError("Serial rack addresses must be unique per device")
    old = cabinet.device_id
    cabinet.device = target
    cabinet.save()
    for device in devices:
        if device.pk in {old, device_id}:
            refresh(device, full=True)


def online(device):
    return device.enabled and device.last_seen and device.last_seen > timezone.now() - timedelta(seconds=45)


def expire_operations():
    """Missing result is uncertain, never proof that hardware did not execute."""
    cutoff = timezone.now() - timedelta(seconds=30)
    with transaction.atomic():
        for device in Device.objects.select_for_update().order_by('pk'):
            ids = list(Operation.objects.filter(device=device, state__in=['queued', 'sent'],
                       expires_at__lt=cutoff).exclude(execution_state='completed').values_list('pk', flat=True))
            if ids:
                Operation.objects.filter(pk__in=ids).update(state='uncertain', execution_state='timeout',
                                                           execution_updated_at=timezone.now())
                Outbox.objects.filter(device=device, body__message_type='command.execute',
                                      body__command_id__in=[str(pk) for pk in ids]).update(acknowledged=True)


def command_payload(operation):
    action = operation.kind if operation.kind in {"OPEN", "CLOSE", "VENTILATE", "LIGHT"} else "OPEN"
    return {"operation_id": str(operation.pk), "rack_id": operation.rack_id,
            "address": operation.rack.address, "action": action, "expires_at": operation.expires_at.isoformat()}


@transaction.atomic
def create_operation(user, data):
    if not valid_id(data.get("request_key")):
        raise ValueError("request_key must be a unique identifier up to 64 characters")
    device = Device.objects.select_for_update().get(pk=data["device_id"])
    from .permissions import require, source
    require(user, "cabinet.control" if data["kind"] in {"OPEN", "CLOSE", "VENTILATE", "LIGHT"} else "inventory.move", source(device.device_type))
    old = Operation.objects.filter(request_key=data["request_key"]).first()
    if old:
        if old.device_id != device.pk or old.kind != data["kind"] or old.rack_id != int(data["rack_id"]) or old.quantity != int(data.get("quantity", 0)) or old.item_id != data.get("item_id") or old.bin_id != data.get("bin_id"):
            raise ValueError("Idempotency key reused with different request")
        return old
    if not online(device) or device.acknowledged_revision != device.revision or device.revision == 0:
        raise ValueError("Device must be online and synchronized")
    if not device.serial_connected:
        raise ValueError('Device Serial connection is unavailable')
    from django.conf import settings
    if device.device_type == 'IPC' and not settings.HARDWARE_ENABLED:
        raise ValueError('Hardware integration is not implemented; IPC control is disabled')
    rack = Rack.objects.get(pk=data["rack_id"], cabinet__device=device, cabinet__domain=device.device_type)
    if rack.cabinet.configuration_status == "pending_simulator":
        raise ValueError("Simulator does not support this cabinet group yet")
    kind = data["kind"]
    if kind not in {"PUT", "PICK", "ADJUST", "OPEN", "CLOSE", "VENTILATE", "LIGHT"}:
        raise ValueError("Unsupported operation")
    if Operation.objects.filter(device=device).exclude(state__in=["confirmed", "failed", "cancelled"]).exists():
        raise ValueError("Resolve pending operation before sending another command")
    qty = data.get("quantity", 0)
    if type(qty) is not int:
        raise ValueError("Quantity must be an integer")
    if qty < 0 or (kind in {"PUT", "PICK"} and qty == 0):
        raise ValueError("Invalid quantity")
    item = bin_obj = None
    if kind in {"PUT", "PICK", "ADJUST"}:
        item = Item.objects.get(pk=data["item_id"], is_active=True)
        bin_obj = Bin.objects.get(pk=data["bin_id"], shelf__rack=rack)
        stock, _ = Stock.objects.get_or_create(item=item, bin=bin_obj)
        if kind == "PICK" and stock.quantity < qty:
            raise ValueError("Insufficient stock")
        total = Stock.objects.filter(bin=bin_obj).aggregate(n=Sum("quantity"))["n"] or 0
        increment = qty if kind == "PUT" else qty-stock.quantity if kind == "ADJUST" else -qty
        if bin_obj.capacity and total+increment > bin_obj.capacity:
            raise ValueError("Bin capacity exceeded")
    operation = Operation.objects.create(device=device, rack=rack, item=item, bin=bin_obj, kind=kind,
        quantity=qty, requested_by=user, request_key=data["request_key"], expires_at=timezone.now()+timedelta(seconds=30))
    queue(device, "command", "command.execute", command_payload(operation),
          command_id=str(operation.pk), revision=device.revision)
    from .models import AuditLog
    AuditLog.objects.create(actor=user, action="command.create", resource="operation", object_id=str(operation.pk), source_type=source(device.device_type), after={"kind": kind})
    return operation


@transaction.atomic
def confirm_operation(user, operation_id, note, success=True):
    # Lock ordering is always devices -> operation -> stock, including reassignment.
    devices = list(Device.objects.select_for_update().order_by("pk"))
    op = Operation.objects.select_for_update().get(pk=operation_id)
    from .permissions import require, source
    require(user, "inventory.move" if op.item_id else "cabinet.control", source(op.device.device_type))
    if op.state in {"confirmed", "failed", "cancelled"}:
        if (op.state == "confirmed") != success:
            raise ValueError("Operation already resolved with another outcome")
        return op
    if not note.strip():
        raise ValueError("Record operator evidence of actual business outcome")
    if op.state not in {"sent", "uncertain", "expired"}:
        raise ValueError("Wait for device result or status reconciliation")
    if success and op.state == "expired":
        raise ValueError("Expired command did not execute")
    if success and op.item_id:
        stock = Stock.objects.select_for_update().get(item_id=op.item_id, bin_id=op.bin_id)
        delta = op.quantity if op.kind == "PUT" else -op.quantity if op.kind == "PICK" else op.quantity-stock.quantity
        if stock.quantity + delta < 0:
            raise ValueError("Insufficient stock")
        capacity = op.bin.capacity
        total = Stock.objects.filter(bin_id=op.bin_id).aggregate(n=Sum("quantity"))["n"] or 0
        if capacity and total + delta > capacity:
            raise ValueError("Bin capacity exceeded")
        stock.quantity += delta
        stock.save()
        Ledger.objects.create(operation=op, delta=delta, quantity_after=stock.quantity)
        from .models import InventoryTransaction
        InventoryTransaction.objects.create(operation=op, item=op.item, source_type=source(op.device.device_type),
            kind={'PUT':'INBOUND','PICK':'OUTBOUND','ADJUST':'ADJUST'}[op.kind], quantity=op.quantity,
            from_location=op.bin if op.kind=='PICK' else None, to_location=op.bin if op.kind!='PICK' else None,
            actor=user, note=note, request_key='operation-'+str(op.pk))
    op.state = "confirmed" if success else "failed"
    op.confirmed_by, op.confirmation_note = user, note
    op.save()
    from .models import AuditLog
    AuditLog.objects.create(actor=user, action="operation.confirm", resource="operation", object_id=str(op.pk), source_type=source(op.device.device_type), after={"state":op.state, "note":note})
    queue(op.device, "command", "command.finalize", {"state": op.state, "command": command_payload(op)}, command_id=str(op.pk))
    for device in devices:
        refresh(device)
    return op
