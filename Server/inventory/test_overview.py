import io
from django.test import TestCase, override_settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.contrib.auth.models import User, Group
from .models import Stock, Device, Item, AuditLog, InventoryTransaction, RolePermission, Operation, Cabinet, Rack, Bin, RackStatus, Ledger
from .models import PhysicalTransaction
from uuid import uuid4


@override_settings(DEBUG=True)
class InventoryOverviewTests(TestCase):
    def setUp(self):
        call_command('seed_demo_data', allow_demo=True, isolated_fixture=True, stdout=io.StringIO(), verbosity=0)
        self.user = User.objects.create_superuser('overview-test', '', 'test-password')
        self.client.force_login(self.user)

    def get_data(self, source='ALL'):
        response = self.client.get('/api/inventory-overview', {'source_type':source})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_source_totals_locations_and_statuses(self):
        data = self.get_data()
        bearing = [p for p in data['products'] if p['sku']=='BR-A01']
        self.assertEqual([(p['source_type'],p['quantity'],len(p['locations'])) for p in bearing], [('REAL',35,2),('SIMULATION',35,2)])
        self.assertEqual(bearing[0]['barcode'],'893000000001')
        self.assertEqual(bearing[0]['locations'][0]['path'],'IPC01 / Cabinet 01 / Rack 01')
        self.assertEqual({l['status'] for l in data['locations']}, {'AVAILABLE','FULL','FAULT','EMPTY','BUSY'})
        esp = next(p for p in data['products'] if p['sku']=='MCU-ESP32' and p['source_type']=='REAL')
        self.assertEqual((esp['quantity'],esp['stock_status']),(8,'Low Stock'))
        self.assertTrue(any(p['stock_status']=='Out of Stock' for p in data['products']))
        fault = next(p for p in data['products'] if p['sku']=='SW-ESTOP' and p['source_type']=='SIMULATION')
        self.assertEqual(fault['available_quantity'],0)
        self.assertEqual(len(data['transactions']),49)
        self.assertTrue({'PUT','PICK','ADJUSTMENT'} <= {t['kind'] for t in data['transactions']})
        self.assertTrue({'FAILED','CANCELLED','COMPLETED'} <= {t['operation_status'] for t in data['transactions']})
        self.assertEqual({t['sync_status'] for t in data['transactions']},{'Synced','Pending','Failed'})

    def test_requested_topology_distribution_and_capacity(self):
        self.assertEqual(set(Device.objects.values_list('device_id', flat=True)), {'IPC01', 'IPCSIM01'})
        self.assertEqual(Cabinet.objects.filter(device_id='IPC01').count(), 1)
        self.assertEqual(Rack.objects.filter(cabinet__device_id='IPC01').count(), 6)
        self.assertEqual(Cabinet.objects.filter(device_id='IPCSIM01').count(), 22)
        self.assertTrue(all(Rack.objects.filter(cabinet=cabinet).count() == 6 for cabinet in Cabinet.objects.filter(device_id='IPCSIM01')))
        self.assertEqual(Rack.objects.filter(cabinet__device_id='IPCSIM01').count(), 132)
        self.assertGreaterEqual(Bin.objects.filter(stock__isnull=False).values('shelf__rack__cabinet_id').distinct().count(), 15)
        self.assertFalse(any(stock.quantity > stock.bin.capacity for stock in Stock.objects.select_related('bin')))
        self.assertEqual(RackStatus.objects.filter(values__status='FAULT').count(), 3)
        self.assertEqual(PhysicalTransaction.objects.filter(status='PENDING').count(), 1)
        self.assertEqual(PhysicalTransaction.objects.filter(status='CONFLICT').count(), 1)
        self.assertEqual(Ledger.objects.count(), 2)
        self.assertEqual(InventoryTransaction.objects.filter(operation__isnull=False).count(), 2)
        self.assertEqual(Stock.objects.get(item__code='BOLT-M6',bin__code='SIM-C20-R01-L01').quantity, 22)
        for stock in Stock.objects.select_related('bin__shelf__rack__cabinet'):
            expected = 'REAL' if stock.bin.shelf.rack.cabinet.domain == 'IPC' else 'SIMULATION'
            self.assertIn(expected, {'REAL', 'SIMULATION'})
        for entry in InventoryTransaction.objects.select_related('from_location__shelf__rack__cabinet', 'to_location__shelf__rack__cabinet'):
            location = entry.to_location or entry.from_location
            expected = 'REAL' if location.shelf.rack.cabinet.domain == 'IPC' else 'SIMULATION'
            self.assertEqual(entry.source_type, expected)
        for username, role_name in [('demo-admin', 'Admin'), ('demo-supervisor', 'Supervisor'), ('demo-operator', 'Operator')]:
            self.assertTrue(User.objects.get(username=username).groups.filter(name=role_name).exists())

    def test_source_authorization_and_default(self):
        self.assertEqual({p['source_type'] for p in self.client.get('/api/inventory-overview').json()['products']},{'REAL'})
        sim = self.get_data('SIMULATION')
        self.assertEqual({l['ipc_id'] for l in sim['locations']},{'IPCSIM01'})
        role = Group.objects.create(name='Simulation viewer')
        user = User.objects.create_user('simulation-reader')
        user.groups.add(role)
        RolePermission.objects.create(role=role,permission='inventory.view',scope='SIMULATION')
        self.client.force_login(user)
        self.assertEqual({p['source_type'] for p in self.get_data()['products']},{'SIMULATION'})
        self.assertEqual(self.client.get('/api/inventory-overview').status_code,403)

    def test_seed_is_idempotent_and_requires_opt_in(self):
        before=(Stock.objects.count(),Device.objects.count(),Item.objects.count(),AuditLog.objects.count(),Operation.objects.count())
        call_command('seed_demo_data',allow_demo=True,isolated_fixture=True,stdout=io.StringIO(),verbosity=0)
        self.assertEqual(before,(Stock.objects.count(),Device.objects.count(),Item.objects.count(),AuditLog.objects.count(),Operation.objects.count()))
        with self.assertRaises(CommandError):
            call_command('seed_demo_data',isolated_fixture=True)
        with override_settings(DEBUG=False), self.assertRaises(CommandError):
            call_command('seed_demo_data',allow_demo=True,isolated_fixture=True)

    def test_adjustment_stale_guard_audit_and_retry(self):
        stock=Stock.objects.get(item__code='BR-A01',bin__code='REAL-C01-R01-L01')
        data=dict(kind='ADJUST',item_id=stock.item_id,to_location_id=stock.bin_id,quantity=22,expected_quantity=19,note='Count verified',request_key='test-adjust',source_type='REAL')
        self.assertEqual(self.client.post('/api/inventory-transactions',data,content_type='application/json').status_code,400)
        stock.refresh_from_db()
        self.assertEqual(stock.quantity,20)
        data['expected_quantity']=20
        first=self.client.post('/api/inventory-transactions',data,content_type='application/json')
        self.assertEqual(first.status_code,201,first.content)
        second=self.client.post('/api/inventory-transactions',data,content_type='application/json')
        self.assertEqual(first.json(),second.json())
        stock.refresh_from_db()
        self.assertEqual(stock.quantity,22)
        entry=InventoryTransaction.objects.get(request_key='test-adjust')
        audit=AuditLog.objects.get(resource='inventory-transaction',object_id=str(entry.pk))
        self.assertEqual(audit.before[str(stock.bin_id)],20)
        self.assertEqual(audit.after[str(stock.bin_id)],22)

    def test_offline_conflict_is_visible_without_changing_stock(self):
        stock=Stock.objects.get(item__code='BR-A01',bin__code='SIM-C01-R02-L01')
        PhysicalTransaction.objects.create(transaction_id=uuid4(),device_id='IPCSIM01',digest='test',status='CONFLICT',error='Reconcile baseline',
            payload={'product_id':stock.item_id,'location_id':stock.bin_id,'user_id':self.user.pk,'operation_type':'PICK','quantity':100})
        data=self.get_data('SIMULATION')
        product=next(p for p in data['products'] if p['sku']=='BR-A01')
        self.assertEqual(product['quantity'],35)
        self.assertEqual(product['sync_status'],'Failed')
        self.assertTrue(any(t['sync_status']=='Failed' and t['reason']=='Reconcile baseline' for t in data['transactions']))
        self.assertFalse(any(t['sync_status']=='Failed' for t in self.get_data('REAL')['transactions']))

    def test_product_history_is_scoped_and_paginated(self):
        stock=Stock.objects.get(item__code='MCU-ESP32',bin__code='REAL-C01-R02-L01')
        initial_count=len(self.client.get('/api/inventory-overview',{'source_type':'REAL','item_id':stock.item_id}).json()['transactions'])
        InventoryTransaction.objects.bulk_create([InventoryTransaction(item=stock.item,source_type='REAL',kind='ADJUST',quantity=8,to_location=stock.bin,actor=self.user,note='History paging fixture',request_key=f'page-{i}') for i in range(105)])
        params={'source_type':'REAL','item_id':stock.item_id}
        first=self.client.get('/api/inventory-overview',params).json()['transactions']
        second=self.client.get('/api/inventory-overview',{**params,'offset':100}).json()['transactions']
        self.assertEqual((len(first),len(second)),(100,initial_count+5))
        self.assertEqual(len({t['id'] for t in first+second}),initial_count+105)
        simulation_rows=self.client.get('/api/inventory-overview',{**params,'source_type':'SIMULATION'}).json()['transactions']
        self.assertTrue(simulation_rows)
        self.assertTrue(all(row['source_type']=='SIMULATION' for row in simulation_rows))

    def test_legacy_all_endpoints_do_not_sum_sources(self):
        goods=self.client.get('/api/goods?source_type=ALL').json()
        bearing=next(p for p in goods if p['code']=='BR-A01')
        self.assertIsNone(bearing['quantity'])
        self.assertEqual(bearing['quantity_by_source'],{'REAL':35,'SIMULATION':35})
        self.assertIsNone(self.client.get('/api/dashboard?source_type=ALL').json()['quantity'])
