"""Seed a deterministic, labelled development inventory fixture."""
import hashlib
import json
import secrets
from datetime import timedelta
from django.conf import settings
from django.contrib.auth.models import Group, Permission, User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from Server.inventory.models import (
    AuditLog, Bin, Cabinet, Category, Device, InventoryTransaction, Item, Ledger, Operation, PhysicalTransaction,
    Rack, RackStatus, RolePermission, Shelf, Stock,
)
from Server.inventory.permissions import PERMISSIONS
from Server.inventory.services import refresh

MARKER = 'smart-inventory-demo-v3'
DEVICES = (
    ('IPC01', 'IPC', 'Physical IPC', ['REAL-C01']),
    ('IPCSIM01', 'IPCSIM', 'Simulation IPC', [f'SIM-C{i:02d}' for i in range(1, 23)]),
)
CATEGORIES = {
    'MECHANICAL': 'Mechanical',
    'ELECTRONICS': 'Electronics',
    'SENSOR': 'Sensor',
    'COMMUNICATION': 'Communication',
    'MOTOR-DRIVER': 'Motor & Driver',
    'ELECTRICAL': 'Electrical',
    'ACCESSORY': 'Accessory',
}
PRODUCTS = (
    ('BR-A01', 'Bearing A01', 'MECHANICAL', 'pcs', 10, 100, 'Deep groove ball bearing, demo stock.'),
    ('BR-A02', 'Bearing A02', 'MECHANICAL', 'pcs', 10, 80, 'Alternate bearing size.'),
    ('MCU-ESP32', 'ESP32 DevKit', 'ELECTRONICS', 'pcs', 12, 80, 'Development board.'),
    ('SNS-DHT22', 'DHT22 Sensor', 'SENSOR', 'pcs', 8, 60, 'Temperature and humidity sensor.'),
    ('SNS-MQ2', 'MQ2 Sensor', 'SENSOR', 'pcs', 8, 60, 'Combustible gas sensor.'),
    ('MOD-LM393', 'LM393 Module', 'ELECTRONICS', 'pcs', 5, 60, 'Comparator module.'),
    ('COM-MAX485', 'MAX485 Module', 'COMMUNICATION', 'pcs', 10, 100, 'RS485 transceiver module.'),
    ('SW-LIMIT', 'Limit Switch', 'ACCESSORY', 'pcs', 5, 80, 'Mechanical travel limit switch.'),
    ('DRV-DM2C', 'DM2C-RS556 Driver', 'MOTOR-DRIVER', 'pcs', 5, 40, 'Stepper motor driver.'),
    ('MOT-42HD', '42HD1023S Motor', 'MOTOR-DRIVER', 'pcs', 5, 60, 'Stepper motor.'),
    ('CAB-RS485', 'RS485 Cable', 'COMMUNICATION', 'm', 10, 100, 'Shielded data cable.'),
    ('PSU-24V', 'Power Supply 24V', 'ELECTRICAL', 'pcs', 5, 60, '24 volt power supply.'),
    ('TERM-BLOCK', 'Terminal Block', 'ELECTRICAL', 'pcs', 10, 100, 'DIN rail terminal block.'),
    ('MOD-RELAY', 'Relay Module', 'ELECTRONICS', 'pcs', 5, 50, 'Interface relay module.'),
    ('SW-ESTOP', 'Emergency Stop Button', 'ACCESSORY', 'pcs', 3, 30, 'Twist release emergency stop.'),
    ('SNS-PROX', 'Proximity Sensor', 'SENSOR', 'pcs', 5, 50, 'Inductive proximity sensor.'),
    ('FUSE-5A', 'Fuse 5A', 'ELECTRICAL', 'pcs', 10, 100, 'Five amp replacement fuse.'),
    ('BOLT-M6', 'Bolt M6', 'ACCESSORY', 'pcs', 20, 200, 'M6 machine bolt.'),
    ('LED-STACK', 'Indicator Stack Light', 'ELECTRICAL', 'pcs', 3, 30, 'Three-color indicator light.'),
    ('KIT-MOUNT', 'Sensor Mounting Kit', 'ACCESSORY', 'pcs', 2, 24, 'Mounting hardware; intentionally unstocked.'),
)

# Explicit placements make every simulation cabinet visible without scattering stock randomly.
PLACEMENTS = (
    ('BR-A01', 'REAL-C01-R01', 20), ('MCU-ESP32', 'REAL-C01-R02', 8),
    ('BR-A01', 'REAL-C01-R03', 15), ('BR-A02', 'SIM-C22-R03', 16),
    ('PSU-24V', 'REAL-C01-R05', 10), ('FUSE-5A', 'REAL-C01-R06', 4),
    ('SNS-DHT22', 'SIM-C01-R01', 12), ('BR-A01', 'SIM-C01-R02', 10),
    ('MOD-RELAY', 'SIM-C01-R03', 18), ('SW-LIMIT', 'SIM-C01-R04', 16),
    ('FUSE-5A', 'SIM-C01-R05', 10), ('SW-LIMIT', 'SIM-C01-R06', 12),
    ('BR-A02', 'SIM-C02-R01', 9),
    ('MCU-ESP32', 'SIM-C03-R01', 18), ('SNS-MQ2', 'SIM-C04-R02', 12),
    ('MOD-RELAY', 'SIM-C04-R06', 4), ('SNS-DHT22', 'SIM-C05-R03', 5),
    ('SW-LIMIT', 'SIM-C06-R03', 9), ('BR-A01', 'SIM-C07-R04', 25),
    ('DRV-DM2C', 'SIM-C08-R01', 4), ('MOT-42HD', 'SIM-C09-R02', 6),
    ('SW-ESTOP', 'SIM-C10-R04', 2), ('COM-MAX485', 'SIM-C11-R05', 40),
    ('CAB-RS485', 'SIM-C12-R01', 18), ('PSU-24V', 'SIM-C13-R02', 10),
    ('TERM-BLOCK', 'SIM-C14-R03', 14), ('MOD-LM393', 'SIM-C15-R01', 8),
    ('MOD-RELAY', 'SIM-C16-R04', 12), ('FUSE-5A', 'SIM-C17-R05', 14),
    ('BR-A02', 'SIM-C18-R02', 11), ('SNS-PROX', 'SIM-C19-R03', 5),
    ('BOLT-M6', 'SIM-C20-R01', 22), ('CAB-RS485', 'SIM-C21-R02', 11),
    ('LED-STACK', 'SIM-C22-R06', 60),
)
CAPACITIES = {
    'REAL-C01-R01': 50, 'REAL-C01-R02': 30, 'REAL-C01-R03': 40,
    'SIM-C01-R02': 50, 'SIM-C03-R01': 40, 'SIM-C05-R03': 40,
    'SIM-C07-R04': 50, 'SIM-C11-R05': 50, 'SIM-C22-R06': 60,
}
FAULT_RACKS = {'REAL-C01-R06', 'SIM-C10-R04', 'SIM-C18-R02'}
BUSY_RACKS = {'SIM-C04-R06'}


class Command(BaseCommand):
    help = 'Seed a deterministic, labelled development inventory for IPC01 and IPCSIM01.'

    def add_arguments(self, parser):
        parser.add_argument('--allow-demo', action='store_true', help='Required confirmation for development sample data')
        parser.add_argument('--dry-run', action='store_true')
        parser.add_argument('--isolated-fixture', action='store_true', help='Build a UI-only fixture with demo liveness; requires DEBUG=1')
        parser.add_argument('--queue-sync', action='store_true', help='Queue authoritative snapshots without fabricating device liveness or ACKs')

    @transaction.atomic
    def handle(self, *args, **options):
        if not options['allow_demo']:
            raise CommandError('Pass --allow-demo to seed development/sample data.')
        if (options['isolated_fixture'] or options['queue_sync']) and not settings.DEBUG:
            raise CommandError('Fixture and queue-sync modes require DJANGO_DEBUG=1; never use them on production.')
        if AuditLog.objects.filter(action='demo.seed', object_id=MARKER).exists():
            self.stdout.write('Demo already seeded; no changes made.')
            return
        if not options['isolated_fixture'] and (Device.objects.exists() or not settings.DEBUG):
            return self.seed_empty_devices(options)
        if not settings.DEBUG:
            raise CommandError('Seeding an empty database requires DJANGO_DEBUG=1 and --allow-demo.')
        return self.seed_full(options, queue_sync=options['queue_sync'])

    def seed_empty_devices(self, options):
        if set(Device.objects.values_list('device_id', flat=True)) != {'IPC01', 'IPCSIM01'}:
            raise CommandError('Expected exactly IPC01 and IPCSIM01 before seeding; use the guarded development reset first.')
        if Item.objects.exists() or Cabinet.objects.exists() or Stock.objects.exists() or InventoryTransaction.objects.exists():
            raise CommandError('Database is not empty; use the guarded development reset before reseeding.')
        # Runtime reset flow always starts from an empty schema. Keep this branch as a guard, not a partial seed.
        raise CommandError('Seed requires an empty database; run tools/reset_development.ps1 first.')

    def seed_full(self, options, queue_sync):
        conflicts = (Device.objects.exists() or Cabinet.objects.exists() or Rack.objects.exists()
                     or Item.objects.exists() or User.objects.filter(username='demo-audit').exists())
        if conflicts:
            raise CommandError('Refusing to layer demo data onto existing records; reset the development database first.')

        now = timezone.now()
        actor = User.objects.create_user('demo-audit', is_active=False)
        actor.set_unusable_password()
        actor.save()
        devices, bins_by_code, racks_by_code, capacities = {}, {}, {}, {}

        for identity, device_type, display_name, cabinet_codes in DEVICES:
            device = Device.objects.create(
                device_id=identity, device_type=device_type, name=display_name,
                last_seen=None if queue_sync else now,
                last_sync=None if queue_sync else now,
                revision=0 if queue_sync else (2 if options['isolated_fixture'] and identity == 'IPC01' else 1),
                acknowledged_revision=0 if queue_sync else 1,
                serial_connected=not queue_sync,
            )
            devices[identity] = device
            for cabinet_index, cabinet_code in enumerate(cabinet_codes, 1):
                cabinet = Cabinet.objects.create(
                    code=cabinet_code,
                    name='Physical Cabinet 01' if cabinet_code == 'REAL-C01' else f'Simulation Cabinet {cabinet_index:02d}',
                    domain=device_type, device=device, group=str(cabinet_index), cabinet_index=cabinet_index,
                    description='Physical IPC for hardware cabinet emulator' if device_type == 'IPC' else f'Demo simulation group {cabinet_index:02d}',
                    configuration_status='demo', topology_locked=True,
                )
                for rack_index in range(1, 7):
                    rack_code = f'REAL-C01-R{rack_index:02d}' if device_type == 'IPC' else f'{cabinet_code}-R{rack_index:02d}'
                    address = rack_index if device_type == 'IPC' else (cabinet_index - 1) * 6 + rack_index
                    capacity = CAPACITIES.get(rack_code, (30, 40, 50, 60)[(rack_index - 1) % 4])
                    rack = Rack.objects.create(cabinet=cabinet, address=address, rack_index=rack_index, code=rack_code, name=f'Rack {rack_index:02d}')
                    shelf = Shelf.objects.create(rack=rack, code=f'{rack_code}-S01', level=1)
                    bin_obj = Bin.objects.create(shelf=shelf, code=f'{rack_code}-L01', capacity=capacity)
                    racks_by_code[rack_code] = rack
                    bins_by_code[rack_code] = bin_obj
                    capacities[rack_code] = capacity
                    status = 'FAULT' if rack_code in FAULT_RACKS else 'BUSY' if rack_code in BUSY_RACKS else 'AVAILABLE'
                    RackStatus.objects.create(rack=rack, values={'status': status}, updated_at=now - timedelta(minutes=address))

        categories = {
            code: Category.objects.create(code=code, name=name, description=f'Demo category: {name}.')
            for code, name in CATEGORIES.items()
        }
        items = {}
        for index, (sku, name, category_code, unit, minimum, maximum, description) in enumerate(PRODUCTS, 1):
            items[sku] = Item.objects.create(
                code=sku, name=name, barcode=str(893000000000 + index), category=categories[category_code],
                unit=unit, min_qty=minimum, max_qty=maximum, description=description,
                is_active=True, is_demo=True,
            )
        for sku, rack_code, quantity in PLACEMENTS:
            if quantity > capacities[rack_code]:
                raise CommandError(f'{rack_code} stock exceeds configured capacity.')
            Stock.objects.create(item=items[sku], bin=bins_by_code[rack_code], quantity=quantity)
            Stock.objects.filter(item=items[sku], bin=bins_by_code[rack_code]).update(
                updated_at=now - timedelta(days=(len(PLACEMENTS) % 14) + 1))

        self.create_transactions(actor, items, bins_by_code, racks_by_code, devices, now)
        demo_credentials = self.create_roles()
        conflict = PhysicalTransaction.objects.create(
            transaction_id=__import__('uuid').uuid4(), device=devices['IPCSIM01'],
            digest=hashlib.sha256(b'demo-conflict').hexdigest(), status='CONFLICT',
            error='Demo conflict for sync-status UI; no stock change was applied.',
            payload={'product_id': items['SNS-DHT22'].pk, 'location_id': bins_by_code['SIM-C05-R03'].pk,
                     'user_id': actor.pk, 'operation_type': 'PICK', 'quantity': 3,
                     'completed_at': (now - timedelta(hours=3)).isoformat()},
            received_at=now - timedelta(hours=3),
        )
        PhysicalTransaction.objects.filter(pk=conflict.pk).update(received_at=now - timedelta(hours=3))
        pending = PhysicalTransaction.objects.create(
            transaction_id=__import__('uuid').uuid4(), device=devices['IPC01'],
            digest=hashlib.sha256(b'demo-pending').hexdigest(), status='PENDING',
            error='DEMO pending sync sample; no stock change was applied.',
            payload={'product_id': items['MCU-ESP32'].pk, 'location_id': bins_by_code['REAL-C01-R02'].pk,
                     'user_id': actor.pk, 'operation_type': 'PUT', 'quantity': 2,
                     'completed_at': (now - timedelta(hours=2)).isoformat()},
            received_at=now - timedelta(hours=2),
        )
        PhysicalTransaction.objects.filter(pk=pending.pk).update(received_at=now - timedelta(hours=2))
        AuditLog.objects.create(
            actor=actor, action='demo.seed', resource='fixture', object_id=MARKER,
            after={'devices': 2, 'cabinets': 23, 'racks': 138, 'products': len(PRODUCTS),
                   'stock_locations': len(PLACEMENTS), 'inventory_transactions': 43, 'operations': 6,
                   'physical_sync_pending': 1, 'physical_sync_conflicts': 1},
        )

        if queue_sync:
            for device in devices.values():
                refresh(device, full=True)
        if options['dry_run']:
            transaction.set_rollback(True)
        self.stdout.write(json.dumps({
            'dry_run': options['dry_run'], 'devices': 2, 'cabinets': 23, 'racks': 138,
            'categories': len(CATEGORIES), 'products': len(PRODUCTS), 'stock_locations': len(PLACEMENTS),
            'inventory_transactions': 43, 'operations': 6, 'physical_sync_pending': 1,
            'physical_sync_conflicts': 1,
            'sync_queued': queue_sync, 'demo_users': demo_credentials,
        }))

    def create_roles(self):
        groups = {}
        for name in ('Admin', 'Supervisor', 'Operator'):
            group, _ = Group.objects.get_or_create(name=name)
            groups[name] = group
            permissions = Permission.objects.filter(content_type__app_label='inventory')
            if name == 'Supervisor':
                permissions = permissions.filter(Q(codename__startswith='view_') | Q(codename__in=['change_operation', 'add_operation']))
            elif name == 'Operator':
                permissions = permissions.filter(codename__startswith='view_')
            group.permissions.add(*permissions)
            custom = PERMISSIONS if name == 'Admin' else [p for p in PERMISSIONS if p.endswith('.view')]
            if name == 'Supervisor':
                custom += ['cabinet.control', 'inventory.move', 'inventory.create', 'inventory.update', 'alarm.acknowledge']
            elif name == 'Operator':
                custom += ['cabinet.control', 'inventory.move', 'alarm.acknowledge']
            for permission in set(custom):
                RolePermission.objects.get_or_create(role=group, permission=permission, scope='ALL')
        credentials = {}
        for name, group in (('demo-admin', 'Admin'), ('demo-supervisor', 'Supervisor'), ('demo-operator', 'Operator')):
            password = secrets.token_urlsafe(18)
            user = User.objects.create_user(name, password=password, is_staff=group == 'Admin')
            user.groups.add(groups[group])
            credentials[name] = password
        return credentials

    def create_transactions(self, actor, items, bins, racks, devices, now):
        movements = [
            ('REAL', 'OUTBOUND', 'BR-A01', 'REAL-C01-R01', 5), ('REAL', 'INBOUND', 'MCU-ESP32', 'REAL-C01-R02', 10),
            ('REAL', 'ADJUST', 'BR-A02', 'REAL-C01-R04', 16), ('REAL', 'OUTBOUND', 'PSU-24V', 'REAL-C01-R05', 2),
            ('REAL', 'INBOUND', 'FUSE-5A', 'REAL-C01-R06', 6), ('SIMULATION', 'OUTBOUND', 'BR-A01', 'SIM-C01-R02', 2),
            ('SIMULATION', 'INBOUND', 'BR-A02', 'SIM-C02-R01', 5), ('SIMULATION', 'OUTBOUND', 'MCU-ESP32', 'SIM-C03-R01', 3),
            ('SIMULATION', 'ADJUST', 'SNS-MQ2', 'SIM-C04-R02', 12), ('SIMULATION', 'INBOUND', 'SNS-DHT22', 'SIM-C05-R03', 4),
            ('SIMULATION', 'OUTBOUND', 'SW-LIMIT', 'SIM-C06-R03', 2), ('SIMULATION', 'INBOUND', 'BR-A01', 'SIM-C07-R04', 5),
            ('SIMULATION', 'OUTBOUND', 'DRV-DM2C', 'SIM-C08-R01', 1), ('SIMULATION', 'INBOUND', 'MOT-42HD', 'SIM-C09-R02', 3),
            ('SIMULATION', 'OUTBOUND', 'SNS-DHT22', 'SIM-C10-R04', 1), ('SIMULATION', 'INBOUND', 'COM-MAX485', 'SIM-C11-R05', 5),
            ('SIMULATION', 'ADJUST', 'CAB-RS485', 'SIM-C12-R01', 18), ('SIMULATION', 'OUTBOUND', 'PSU-24V', 'SIM-C13-R02', 1),
            ('SIMULATION', 'INBOUND', 'TERM-BLOCK', 'SIM-C14-R03', 4), ('SIMULATION', 'OUTBOUND', 'MOD-LM393', 'SIM-C15-R01', 1),
            ('SIMULATION', 'INBOUND', 'MOD-RELAY', 'SIM-C16-R04', 2), ('SIMULATION', 'OUTBOUND', 'FUSE-5A', 'SIM-C17-R05', 2),
            ('SIMULATION', 'INBOUND', 'BR-A02', 'SIM-C18-R02', 4), ('SIMULATION', 'OUTBOUND', 'SNS-PROX', 'SIM-C19-R03', 1),
            ('SIMULATION', 'INBOUND', 'BOLT-M6', 'SIM-C20-R01', 10), ('SIMULATION', 'OUTBOUND', 'CAB-RS485', 'SIM-C21-R02', 2),
            ('SIMULATION', 'OUTBOUND', 'LED-STACK', 'SIM-C22-R06', 5),
        ]
        for index in range(14):
            scope, kind, sku, rack_code, quantity = movements[index % len(movements)]
            movements.append((scope, kind, sku, rack_code, quantity))

        for index, (scope, kind, sku, rack_code, quantity) in enumerate(movements, 1):
            bin_obj = bins[rack_code]
            location_kw = {'from_location': bin_obj, 'to_location': None} if kind == 'OUTBOUND' else {'from_location': None, 'to_location': bin_obj}
            entry = InventoryTransaction.objects.create(
                item=items[sku], source_type=scope, kind=kind, quantity=quantity,
                actor=actor, note='DEMO history only; current stock is the seeded snapshot.',
                request_key=f'TX-DEMO-{index:03d}', **location_kw,
            )
            InventoryTransaction.objects.filter(pk=entry.pk).update(created_at=now - timedelta(days=(index % 18), hours=index % 12))
            device = devices['IPC01'] if scope == 'REAL' else devices['IPCSIM01']
            rack = racks[rack_code]
            if rack.cabinet.device_id != device.pk:
                raise CommandError(f'{rack_code} has a device/source mismatch.')

        operation_specs = (
            ('REAL', 'PICK', 'BR-A01', 'REAL-C01-R01', 'failed'),
            ('REAL', 'PUT', 'MCU-ESP32', 'REAL-C01-R02', 'cancelled'),
            ('SIMULATION', 'PICK', 'SNS-DHT22', 'SIM-C05-R03', 'failed'),
            ('SIMULATION', 'PUT', 'BOLT-M6', 'SIM-C20-R01', 'confirmed'),
            ('SIMULATION', 'PICK', 'BOLT-M6', 'SIM-C20-R01', 'confirmed'),
            ('SIMULATION', 'PUT', 'SNS-PROX', 'SIM-C19-R03', 'queued'),
        )
        for index, (scope, kind, sku, rack_code, state) in enumerate(operation_specs, 1):
            rack = racks[rack_code]
            operation = Operation.objects.create(
                device=devices['IPC01'] if scope == 'REAL' else devices['IPCSIM01'],
                item=items[sku], bin=bins[rack_code], rack=rack, kind=kind, quantity=2,
                state=state, execution_state=state if state in {'failed', 'cancelled', 'confirmed'} else 'awaiting_device',
                execution_updated_at=now - timedelta(days=index) if state != 'queued' else None,
                requested_by=actor, confirmed_by=actor if state in {'failed', 'confirmed', 'cancelled'} else None,
                request_key=f'OP-DEMO-{index:03d}',
                expires_at=now + timedelta(days=1) if state == 'queued' else now - timedelta(days=index),
                confirmation_note=f'DEMO {state.upper()} operation; stock unchanged.',
                created_at=now - timedelta(days=index, hours=2),
            )
            created_at = now - timedelta(days=index, hours=2)
            Operation.objects.filter(pk=operation.pk).update(created_at=created_at)
            if state == 'confirmed':
                stock = Stock.objects.get(item=items[sku], bin=bins[rack_code])
                delta = quantity if kind == 'PUT' else -quantity
                stock.quantity += delta
                stock.save(update_fields=['quantity', 'updated_at'])
                ledger = Ledger.objects.create(operation=operation, delta=delta, quantity_after=stock.quantity)
                Ledger.objects.filter(pk=ledger.pk).update(created_at=created_at + timedelta(minutes=1))
                entry = InventoryTransaction.objects.create(
                    item=items[sku], source_type=scope,
                    kind='INBOUND' if kind == 'PUT' else 'OUTBOUND', quantity=quantity,
                    from_location=bins[rack_code] if kind == 'PICK' else None,
                    to_location=bins[rack_code] if kind == 'PUT' else None,
                    actor=actor, note=f'DEMO confirmed {kind}; balanced operation sample.',
                    request_key=f'operation-{operation.pk}', operation=operation,
                )
                InventoryTransaction.objects.filter(pk=entry.pk).update(created_at=created_at + timedelta(minutes=1))