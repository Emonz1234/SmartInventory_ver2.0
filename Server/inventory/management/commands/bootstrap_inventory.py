"""Explicit, non-destructive Server bootstrap. No startup seed and no stock fabrication."""
import json
from pathlib import Path
import secrets
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.contrib.auth.models import Group, Permission
from Server.inventory.models import Device, Cabinet, Rack, Shelf, Bin, Category, Item, AuditLog
from Server.inventory.services import refresh


class Command(BaseCommand):
    help = 'Bootstrap IPC1 (6 pending cabinets) and IPCSIM (21 groups x 6 Serial racks)'

    def add_arguments(self, parser):
        parser.add_argument('--ipc-device-id', default='IPC1')
        parser.add_argument('--sim-device-id', default='IPCSIM')
        parser.add_argument('--demo-catalog', action='store_true')
        parser.add_argument('--demo-locations', action='store_true')
        parser.add_argument('--credentials-file', help='New file for device secrets; never printed to console')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        from ipc_core.protocol import valid_id
        from Simulation.topology import GROUP_COUNT, RACKS_PER_GROUP as MAX_RACK_NUMBER
        output = Path(options['credentials_file']).resolve() if options['credentials_file'] else None
        if output and output.exists():
            raise CommandError('Credentials file exists; refusing to overwrite')
        ids = [options['ipc_device_id'], options['sim_device_id']]
        if len(set(ids)) != 2 or not all(valid_id(v) and v != 'inventory-server' for v in ids):
            raise CommandError('Device IDs must be unique and valid')
        counts = {}
        credentials = {}
        with transaction.atomic():
            # Same ordering as master-data services; lock current registry before changing scopes.
            list(Device.objects.select_for_update().order_by('pk'))
            for identity, kind, total in ((ids[0], 'IPC', 6), (ids[1], 'IPCSIM', GROUP_COUNT)):
                device, created = Device.objects.get_or_create(device_id=identity, defaults={
                    'device_type': kind, 'name': identity, 'secret': secrets.token_urlsafe(48)})
                if device.device_type != kind:
                    raise CommandError(f'{identity} already belongs to another domain')
                credentials[identity] = {'DEVICE_ID': identity, 'DEVICE_TYPE': kind, 'DEVICE_SECRET': device.secret}
                counts[kind] = {'cabinets_added': 0, 'racks_added': 0}
                for number in range(1, total + 1):
                    cabinet, created = Cabinet.objects.get_or_create(domain=kind, code=str(number), defaults={
                        'name': f'{identity} - Group {number}' if kind == 'IPCSIM' else f'IPC1 - Cabinet {number}',
                        'device': device, 'group': str(number), 'topology_locked': True,
                        'configuration_status': 'serial_mapped' if kind == 'IPCSIM' else 'pending_hardware',
                        'description': 'Simulation: 6 racks; compartment layout not defined' if kind == 'IPCSIM' else
                                       'Hardware chưa đặc tả; chưa có rack/address/ô chứa'})
                    if cabinet.device_id != device.pk:
                        raise CommandError(f'{kind} cabinet code {number} already exists outside {identity}; no reassignment performed')
                    counts[kind]['cabinets_added'] += int(created)
                    if kind == 'IPCSIM':
                        expected = set(range((number-1)*MAX_RACK_NUMBER+1, number*MAX_RACK_NUMBER+1))
                        if set(cabinet.rack_set.values_list('address', flat=True)) - expected:
                            raise CommandError(f'Simulation mapping conflict in group {number}')
                        for address in sorted(expected):
                            if Rack.objects.filter(cabinet__device=device, address=address).exclude(cabinet=cabinet).exists():
                                raise CommandError(f'Serial address {address} is already assigned elsewhere')
                            _, added = Rack.objects.get_or_create(cabinet=cabinet, address=address,
                                defaults={'name': f'Rack {address}'})
                            counts[kind]['racks_added'] += int(added)
            if options['demo_catalog']:
                samples = [('A1001', 'Motor Bearing', 'pcs', 'MECHANICAL'),
                           ('B2002', 'Coupling Assembly', 'pcs', 'MECHANICAL'),
                           ('C3003', 'Hydraulic Seal', 'pcs', 'MECHANICAL'),
                           ('D4004', 'Sensor Cable', 'm', 'ELECTRICAL'),
                           ('E5005', 'Control Board', 'pcs', 'ELECTRICAL')]
                for code, name, unit, category_code in samples:
                    category, _ = Category.objects.get_or_create(code=category_code, defaults={'name': category_code})
                    Item.objects.get_or_create(code=code, defaults={'name': name, 'unit': unit, 'category': category,
                        'description': 'Danh mục mẫu phát triển; không phải tồn kho đã xác nhận', 'is_demo': True})
            if options['demo_locations']:
                # The retained legacy seed/database defines ONLY rack 1, shelf 1 and these three bins.
                rack = Rack.objects.get(cabinet__device_id=ids[1], address=1)
                shelf, _ = Shelf.objects.get_or_create(rack=rack, code='A-R01-S01', defaults={'level': 1})
                for number in range(1, 4):
                    Bin.objects.get_or_create(shelf=shelf, code=f'A-R01-S01-B{number:02d}', defaults={'capacity': 100})
            for name in ('Viewer', 'Operator', 'Admin'):
                group, _ = Group.objects.get_or_create(name=name)
                permissions = Permission.objects.filter(content_type__app_label='inventory')
                if name != 'Admin':
                    from django.db.models import Q
                    wanted = Q(codename__startswith='view_')
                    if name == 'Operator':
                        wanted |= Q(codename__in=['add_operation', 'change_operation'])
                    permissions = permissions.filter(wanted)
                group.permissions.add(*permissions)
            for device in Device.objects.select_for_update().order_by('pk'):
                refresh(device)
            if any(any(row.values()) for row in counts.values()):
                AuditLog.objects.create(action='bootstrap', resource='topology', object_id=','.join(ids), after=counts)
            if options['dry_run']:
                transaction.set_rollback(True)
        if output and not options['dry_run']:
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open('x', encoding='utf-8') as handle:
                json.dump(credentials, handle, ensure_ascii=False, indent=2)
            output.chmod(0o600)
        self.stdout.write(json.dumps({'dry_run': options['dry_run'], 'added': counts,
            'stock_created': 0, 'transactions_created': 0}, ensure_ascii=False))
