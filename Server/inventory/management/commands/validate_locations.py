"""Validate the two independent location trees without changing inventory."""
import json
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from Server.inventory.models import Device, Cabinet, Rack, Stock, Operation, InventoryTransaction, PhysicalTransaction, Bin
from Server.inventory.permissions import source


class Command(BaseCommand):
    help = 'Validate parent/local indices, inventory and transaction ownership; optionally refresh sync snapshots.'

    def add_arguments(self, parser):
        parser.add_argument('--demo-topology', action='store_true', help='Require exactly IPC01 1x6 and IPCSIM01 22x6')
        parser.add_argument('--refresh-sync', action='store_true', help='Queue current authoritative snapshots after migration')

    @transaction.atomic
    def handle(self, *args, **options):
        devices = list(Device.objects.select_for_update().order_by('pk'))
        errors, counts = [], {}
        for d in devices:
            cabinets = list(Cabinet.objects.filter(device=d).order_by('cabinet_index'))
            maximum = 1 if d.device_type == 'IPC' else 22
            for c in cabinets:
                if c.domain != d.device_type or not 1 <= c.cabinet_index <= maximum:
                    errors.append(f'{d.pk}/{c.code}: wrong domain or cabinet index')
                racks = list(Rack.objects.filter(cabinet=c).order_by('rack_index'))
                if [r.rack_index for r in racks] != list(range(1, 7)):
                    errors.append(f'{d.pk}/{c.code}: expected rack indices 1..6')
                for r in racks:
                    expected = r.rack_index if d.device_type == 'IPC' else (c.cabinet_index - 1) * 6 + r.rack_index
                    if r.address != expected:
                        errors.append(f'{d.pk}/{c.code}/{r.code}: Serial address mismatch')
            counts[d.pk] = dict(device_type=source(d.device_type), cabinets=len(cabinets), racks=Rack.objects.filter(cabinet__device=d).count())
        if Cabinet.objects.filter(device__isnull=True).exists():
            errors.append('Cabinet without device ownership')
        for stock in Stock.objects.select_related('bin__shelf__rack__cabinet'):
            if not stock.bin.shelf.rack.cabinet.device_id:
                errors.append(f'Stock {stock.pk}: unassigned location')
        for op in Operation.objects.select_related('rack__cabinet', 'bin__shelf'):
            if op.device_id != op.rack.cabinet.device_id or (op.bin_id and op.bin.shelf.rack_id != op.rack_id):
                errors.append(f'Operation {op.pk}: mismatched location/device')
        for t in InventoryTransaction.objects.select_related('from_location__shelf__rack__cabinet', 'to_location__shelf__rack__cabinet'):
            for b in (t.from_location, t.to_location):
                if b and source(b.shelf.rack.cabinet.domain) != t.source_type:
                    errors.append(f'Transaction {t.pk}: cross-domain location')
        for t in PhysicalTransaction.objects.select_related('device'):
            location_id = t.payload.get('location_id')
            if location_id and not Bin.objects.filter(pk=location_id, shelf__rack__cabinet__device_id=t.device_id).exists():
                errors.append(f'Physical transaction {t.pk}: location outside device')
        if options['demo_topology']:
            expected = {'IPC01': ('REAL', 1, 6), 'IPCSIM01': ('SIMULATION', 22, 132)}
            if set(counts) != set(expected):
                errors.append('Demo must contain exactly IPC01 and IPCSIM01')
            for key, (kind, cabinets, racks) in expected.items():
                if counts.get(key) != dict(device_type=kind, cabinets=cabinets, racks=racks):
                    errors.append(f'{key}: wrong demo counts')
        if errors:
            raise CommandError('\n'.join(errors))
        if options['refresh_sync']:
            from Server.inventory.services import refresh
            for d in devices:
                refresh(d, full=True)
        self.stdout.write(json.dumps(dict(valid=True, devices=counts, sync_refreshed=options['refresh_sync'])))
