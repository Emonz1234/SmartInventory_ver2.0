import io
from django.test import TestCase
from django.core.management import call_command, CommandError
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from .models import Device, Cabinet, Rack, Bin, Item, Category, Stock, Operation, Ledger, AuditLog, Outbox


class BootstrapTests(TestCase):
    def bootstrap(self, **kwargs):
        call_command('bootstrap_inventory', demo_catalog=True, demo_locations=True, stdout=io.StringIO(), **kwargs)

    def test_scope_mapping_no_stock_and_repeat_preserves_admin_changes(self):
        self.bootstrap()
        ipc, sim = Device.objects.get(pk='IPC1'), Device.objects.get(pk='IPCSIM')
        self.assertEqual(Cabinet.objects.filter(device=ipc).count(), 1)
        self.assertEqual(Cabinet.objects.filter(device=sim).count(), 22)
        self.assertEqual(Rack.objects.filter(cabinet__device=ipc).count(), 6)
        self.assertEqual(Rack.objects.filter(cabinet__device=sim).count(), 132)
        for rack in Rack.objects.filter(cabinet__device=sim).select_related('cabinet'):
            self.assertEqual((rack.address - 1)//6 + 1, int(rack.cabinet.code))
        self.assertEqual(Bin.objects.count(), 3)
        self.assertEqual(Item.objects.filter(is_demo=True).count(), 5)
        self.assertEqual(Category.objects.count(), 2)
        self.assertEqual(Stock.objects.count() + Operation.objects.count() + Ledger.objects.count(), 0)
        for device, count, rack_count in ((ipc, 1, 6), (sim, 22, 132)):
            self.assertEqual(sum(r['kind'] == 'cabinet' for r in device.snapshot), count)
            self.assertEqual(sum(r['kind'] == 'rack' for r in device.snapshot), rack_count)
            self.assertTrue(all(r.get('domain', device.device_type) == device.device_type for r in device.snapshot))
        item = Item.objects.first()
        item.name, item.is_active = 'Admin retained name', False
        item.save()
        cabinet = Cabinet.objects.filter(device=ipc).first()
        cabinet.name = 'Admin cabinet'
        cabinet.save()
        self.bootstrap()
        revisions = dict(Device.objects.values_list('pk', 'revision'))
        self.bootstrap()
        self.assertEqual(revisions, dict(Device.objects.values_list('pk', 'revision')))
        item.refresh_from_db(); cabinet.refresh_from_db()
        self.assertEqual(item.name, 'Admin retained name')
        self.assertFalse(item.is_active)
        self.assertEqual(cabinet.name, 'Admin cabinet')
        self.assertEqual(Bin.objects.count(), 3)

    def test_sim_only_bootstrap_creates_twenty_two_groups_without_ipc(self):
        call_command('bootstrap_inventory', sim_only=True, stdout=io.StringIO())
        self.assertFalse(Device.objects.filter(pk='IPC1').exists())
        sim = Device.objects.get(pk='IPCSIM')
        self.assertEqual(Cabinet.objects.filter(device=sim).count(), 22)
        self.assertEqual(Rack.objects.filter(cabinet__device=sim).count(), 132)
        self.assertEqual(sum(row['kind'] == 'rack' for row in sim.snapshot), 132)

    def test_dry_run_and_conflict_roll_back_all_changes(self):
        self.bootstrap(dry_run=True)
        self.assertFalse(Device.objects.exists())
        Cabinet.objects.create(code='2', domain='IPCSIM', name='Existing unassigned')
        with self.assertRaises(CommandError):
            self.bootstrap()
        self.assertFalse(Device.objects.exists())
        self.assertEqual(Cabinet.objects.count(), 1)

    def test_permissions_audit_deltas_and_topology_protection(self):
        self.bootstrap()
        viewer = get_user_model().objects.create_user('viewer')
        viewer.groups.add(Group.objects.get(name='Viewer'))
        self.client.force_login(viewer)
        item, cabinet = Item.objects.first(), Cabinet.objects.filter(device_id='IPC1').first()
        self.assertEqual(self.client.patch('/api/items', {'id': item.pk, 'name': 'Bad'}, content_type='application/json').status_code, 403)
        admin = get_user_model().objects.create_user('admin')
        admin.groups.add(Group.objects.get(name='Admin'))
        self.client.force_login(admin)
        Outbox.objects.all().delete()
        response = self.client.patch('/api/items', {'id': item.pk, 'name': 'Updated', 'is_active': False}, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(Outbox.objects.values_list('device_id', flat=True)), {'IPC1', 'IPCSIM'})
        self.assertTrue(all(row.body['message_type'] == 'sync.delta' for row in Outbox.objects.all()))
        Outbox.objects.all().delete()
        response = self.client.patch('/api/cabinets', {'id': cabinet.pk, 'description': 'Named by admin'}, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(Outbox.objects.values_list('device_id', flat=True)), {'IPC1'})
        self.assertEqual(self.client.patch('/api/cabinets', {'id': cabinet.pk, 'code': '7'}, content_type='application/json').status_code, 400)
        self.assertEqual(self.client.delete('/api/cabinets', {'id': cabinet.pk}, content_type='application/json').status_code, 400)
        self.assertEqual(self.client.post('/api/racks', {'cabinet_id': cabinet.pk, 'address': 1}, content_type='application/json').status_code, 400)
        self.assertEqual(AuditLog.objects.filter(actor=admin, result="success").count(), 2)
        self.assertEqual(self.client.get('/api/audit').status_code, 200)
