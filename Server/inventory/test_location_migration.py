from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class LocalIndexMigrationTests(TransactionTestCase):
    def test_existing_primary_keys_addresses_and_stock_are_preserved(self):
        executor = MigrationExecutor(connection)
        executor.migrate([('inventory', '0001_initial')])
        apps = executor.loader.project_state([('inventory', '0001_initial')]).apps
        Device, Cabinet, Rack, Shelf, Bin, Item, Stock = [apps.get_model('inventory', n) for n in ['Device', 'Cabinet', 'Rack', 'Shelf', 'Bin', 'Item', 'Stock']]
        try:
            real = Device.objects.create(device_id='IPC01', device_type='IPC', name='Real')
            sim = Device.objects.create(device_id='IPCSIM01', device_type='IPCSIM', name='Sim')
            for device, count in [(real, 1), (sim, 22)]:
                for index in range(1, count + 1):
                    cabinet = Cabinet.objects.create(device=device, domain=device.device_type, code=f'{device.pk}-C{index:02d}', group=str(index), name='Cabinet')
                    for local in range(1, 7):
                        Rack.objects.create(cabinet=cabinet, address=(index - 1) * 6 + local)
            rack = Rack.objects.get(cabinet__device=sim, cabinet__group='2', address=7)
            original_pk = rack.pk
            shelf = Shelf.objects.create(rack=rack, code='S')
            location = Bin.objects.create(shelf=shelf, code='B')
            item = Item.objects.create(code='P', name='Product', unit='pcs')
            stock = Stock.objects.create(item=item, bin=location, quantity=12)
            executor = MigrationExecutor(connection)
            executor.migrate([('inventory', '0002_local_location_indices')])
            apps = executor.loader.project_state([('inventory', '0002_local_location_indices')]).apps
            Rack, Stock = apps.get_model('inventory', 'Rack'), apps.get_model('inventory', 'Stock')
            updated = Rack.objects.get(pk=original_pk)
            self.assertEqual(updated.address, 7)
            self.assertEqual(updated.rack_index, 1)
            self.assertEqual(updated.cabinet.cabinet_index, 2)
            self.assertEqual(Stock.objects.get(pk=stock.pk).bin.shelf.rack_id, original_pk)
            self.assertEqual(Stock.objects.get(pk=stock.pk).quantity, 12)
            for d in ['IPC01', 'IPCSIM01']:
                first = Rack.objects.get(cabinet__device_id=d, cabinet__cabinet_index=1, rack_index=1)
                self.assertEqual(first.rack_index, 1)
        finally:
            MigrationExecutor(connection).migrate([('inventory', '0003_assigned_cabinet_bounds')])
