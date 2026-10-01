"""Scoped offline grants and idempotent replay of completed physical operations."""
import json
from datetime import datetime
from uuid import UUID
from django.contrib.auth import get_user_model
from django.core import signing
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Sum
from ipc_core.protocol import checksum
from .models import PhysicalTransaction, Stock, Bin, Item, Operation, Ledger, InventoryTransaction, AuditLog
from .permissions import allowed, source


def auth_records(device):
    for user in get_user_model().objects.filter(is_active=True).prefetch_related('groups').order_by('pk'):
        permissions = [p for p in ('inventory.view', 'inventory.move', 'cabinet.view', 'cabinet.control') if allowed(user, p, source(device.device_type))]
        if not user.has_usable_password():
            continue
        if 'inventory.move' in permissions or 'cabinet.control' in permissions:
            permissions += ['inventory.add_operation', 'inventory.change_operation']
        data = dict(id=user.pk, username=user.username, password_hash=user.password,
                    permissions=permissions, roles=list(user.groups.order_by('pk').values_list('name', flat=True)))
        version = checksum(data)
        data['version'] = version
        data['grant'] = signing.Signer(salt='edge-offline-v1').sign_object(
            {'device_id': device.pk, 'user_id': user.pk, 'permissions': permissions, 'version': version})
        yield {'key': f'auth:{user.pk}', 'kind': 'auth', 'domain': device.device_type, 'data': data}


def replay(device, payload):
    """Caller holds device row lock. Conflict is durable and retryable."""
    from .services import refresh
    tid = UUID(payload['transaction_id'])
    digest = checksum(payload)
    row, created = PhysicalTransaction.objects.get_or_create(transaction_id=tid,
        defaults={'device': device, 'digest': digest, 'payload': payload})
    if row.device_id != device.pk or row.digest != digest:
        raise ValueError('Transaction ID collision')
    if row.status == 'APPLIED':
        return {'status': 'APPLIED', 'digest': digest, 'revision': row.applied_revision}
    try:
        with transaction.atomic():
            if payload['ipc_id'] != device.pk or payload['operation_type'] not in ('PUT','PICK'):
                raise ValueError('Invalid transaction scope or type')
            qty = payload['quantity']
            if type(qty) is not int or qty <= 0:
                raise ValueError('Invalid transaction quantity')
            grant = signing.Signer(salt='edge-offline-v1').unsign_object(payload['authorization'])
            if grant['device_id'] != device.pk or grant['user_id'] != payload['user_id'] or 'inventory.move' not in grant['permissions']:
                raise ValueError('Offline authorization does not match transaction')
            started, completed = (datetime.fromisoformat(payload[k]) for k in ('created_at','completed_at'))
            if started.tzinfo is None or completed.tzinfo is None or completed < started:
                raise ValueError('Invalid physical transaction timestamps')
            evidence = json.loads(payload['evidence'])
            endpoint = evidence.get('state') == -1 and evidence.get('is_endpoint') == 1
            if evidence.get('kept_open') is True:
                valid_endpoint = endpoint and isinstance(evidence.get('displacement'), (int, float)) and evidence['displacement'] > 0
            else:
                valid_endpoint = endpoint and evidence.get('displacement') == 0
            if not valid_endpoint:
                raise ValueError('Missing successful CLOSE or explicitly kept-open endpoint evidence')
            if any(evidence.get(k) for k in ('is_obstructed','is_skewed','is_overload_motor')):
                raise ValueError('Faulted hardware cannot commit inventory')
            location = Bin.objects.select_related('shelf__rack__cabinet').get(pk=payload['location_id'],
                shelf__rack_id=payload['rack_id'], shelf__rack__cabinet_id=payload['cabinet_id'],
                shelf__rack__cabinet__device=device)
            item = Item.objects.get(pk=payload['product_id'])
            user = get_user_model().objects.get(pk=payload['user_id'])
            stock, _ = Stock.objects.select_for_update().get_or_create(item=item, bin=location)
            delta = qty if payload['operation_type']=='PUT' else -qty
            total = Stock.objects.filter(bin=location).aggregate(n=Sum('quantity'))['n'] or 0
            if stock.quantity+delta < 0 or (location.capacity and total+delta > location.capacity):
                raise ValueError('Physical stock conflict: reconcile Server baseline, then retry this same transaction')
            stock.quantity += delta
            stock.save(update_fields=['quantity', 'updated_at'])
            op = Operation.objects.create(id=tid, device=device, item=item, bin=location,
                rack=location.shelf.rack, kind=payload['operation_type'], quantity=qty,
                state='confirmed', execution_state='completed', execution_updated_at=completed,
                requested_by=user, confirmed_by=user, confirmation_note=payload.get('note',''),
                request_key='offline-'+str(tid), expires_at=completed)
            Ledger.objects.create(operation=op, delta=delta, quantity_after=stock.quantity)
            InventoryTransaction.objects.create(operation=op, item=item, source_type=source(device.device_type),
                kind='INBOUND' if delta>0 else 'OUTBOUND', quantity=qty,
                from_location=location if delta<0 else None, to_location=location if delta>0 else None,
                actor=user, note=payload.get('note',''), request_key='offline-'+str(tid))
            refresh(device)
            row.status, row.error, row.applied_revision = 'APPLIED', '', device.revision
            row.save(update_fields=['status','error','applied_revision'])
            AuditLog.objects.create(actor=user, action='offline.replay', resource='transaction',
                object_id=str(tid), source_type=source(device.device_type), after={'delta': delta, 'revision': device.revision})
    except (ValueError, KeyError, TypeError, ObjectDoesNotExist, signing.BadSignature) as exc:
        row.status, row.error = 'CONFLICT', str(exc)
        row.save(update_fields=['status','error'])
    return {'status': row.status, 'digest': digest, 'revision': row.applied_revision, 'error': row.error}
