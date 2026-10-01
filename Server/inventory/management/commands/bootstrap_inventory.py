"""Explicit, non-destructive Server bootstrap. No startup seed and no stock fabrication."""
import json
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.contrib.auth.models import Group, Permission
from Server.inventory.models import Device, Cabinet, Rack, Shelf, Bin, Category, Item, AuditLog
from Server.inventory.services import refresh


class Command(BaseCommand):
    help = 'Bootstrap IPC01 (1 group x 6 racks) and IPCSIM01 (22 groups x 6 racks)'

    def add_arguments(self, parser):
        parser.add_argument('--ipc-device-id', default='IPC01')
        parser.add_argument('--sim-device-id', default='IPCSIM01')
        parser.add_argument('--sim-only', action='store_true', help='Bootstrap only the existing IPCSIM device and its 22 groups')
        parser.add_argument('--demo-catalog', action='store_true')
        parser.add_argument('--demo-locations', action='store_true')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        from ipc_core.protocol import valid_id
        from Simulation.topology import GROUP_COUNT, RACKS_PER_GROUP as MAX_RACK_NUMBER
        ids = [options['ipc_device_id'], options['sim_device_id']]
        if len(set(ids)) != 2 or not all(valid_id(v) and v != 'inventory-server' for v in ids):
            raise CommandError('Device IDs must be unique and valid')
        topologies = ((ids[1], 'IPCSIM', 22),) if options['sim_only'] else ((ids[0], 'IPC', 1), (ids[1], 'IPCSIM', 22))
        counts = {}
        with transaction.atomic():
            # Same ordering as master-data services; lock current registry before changing scopes.
            list(Device.objects.select_for_update().order_by('pk'))
            for identity, kind, total in topologies:
                device, created = Device.objects.get_or_create(device_id=identity, defaults={
                    'device_type': kind, 'name': identity})
                if device.device_type != kind:
                    raise CommandError(f'{identity} already belongs to another domain')
                counts[kind] = {'cabinets_added': 0, 'racks_added': 0}
                if kind == 'IPC' and Cabinet.objects.filter(device=device).exclude(code='1').exists():
                    raise CommandError('Existing IPC topology has multiple groups; reconcile existing locations before bootstrapping the one-group topology')
                for number in range(1, total + 1):
                    cabinet, created = Cabinet.objects.get_or_create(domain=kind, code=str(number), defaults={
                        'name': f'{identity} - Group {number}',
                        'device': device, 'group': str(number), 'topology_locked': True,
                        'configuration_status': ('serial_mapped' if number <= GROUP_COUNT else 'pending_simulator') if kind == 'IPCSIM' else 'pending_hardware',
                        'description': 'Simulation: 6 racks; compartment layout not defined' if kind == 'IPCSIM' else
                                       'Hardware chưa đặc tả; chưa có rack/address/ô chứa'})
                    if cabinet.device_id != device.pk:
                        raise CommandError(f'{kind} cabinet code {number} already exists outside {identity}; no reassignment performed')
                    counts[kind]['cabinets_added'] += int(created)
                    if kind in ('IPC', 'IPCSIM'):
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
            from Server.inventory.models import RolePermission
            from Server.inventory.permissions import PERMISSIONS
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
                for permission in PERMISSIONS:
                    if name == 'Admin' or permission.endswith('.view') or (name == 'Operator' and permission in ['cabinet.control','inventory.move','alarm.acknowledge']):
                        RolePermission.objects.get_or_create(role=group, permission=permission, scope='ALL')
            for device in Device.objects.select_for_update().order_by('pk'):
                refresh(device)
            if any(any(row.values()) for row in counts.values()):
                AuditLog.objects.create(action='bootstrap', resource='topology', object_id=','.join(identity for identity, _, _ in topologies), after=counts)
            if options['dry_run']:
                transaction.set_rollback(True)
        self.stdout.write(json.dumps({'dry_run': options['dry_run'], 'added': counts,
            'stock_created': 0, 'transactions_created': 0}, ensure_ascii=False))
