import io
import json
import tempfile
from pathlib import Path
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from .models import Cabinet, Device, Rack, Stock, Operation, InventoryTransaction
from .services import records_for


@override_settings(DEBUG=True)
class LocationIdentityTests(TestCase):
    def setUp(self):
        call_command('seed_demo_data', allow_demo=True, isolated_fixture=True, stdout=io.StringIO())

    def test_independent_local_indices_inventory_and_transaction_ownership(self):
        output = io.StringIO()
        call_command('validate_locations', demo_topology=True, stdout=output)
        result = json.loads(output.getvalue())
        self.assertEqual(result['devices']['IPC01']['cabinets'], 1)
        self.assertEqual(result['devices']['IPC01']['racks'], 6)
        self.assertEqual(result['devices']['IPCSIM01']['cabinets'], 22)
        self.assertEqual(result['devices']['IPCSIM01']['racks'], 132)
        for device, count in [('IPC01', 1), ('IPCSIM01', 22)]:
            cabinets = Cabinet.objects.filter(device_id=device).order_by('cabinet_index')
            self.assertEqual(list(cabinets.values_list('cabinet_index', flat=True)), list(range(1, count + 1)))
            for cabinet in cabinets:
                self.assertEqual(list(cabinet.rack_set.order_by('rack_index').values_list('rack_index', flat=True)), list(range(1, 7)))
        real = Cabinet.objects.get(device_id='IPC01', cabinet_index=1)
        sim = Cabinet.objects.get(device_id='IPCSIM01', cabinet_index=1)
        self.assertNotEqual(real.pk, sim.pk)
        self.assertGreater(sim.rack_set.get(rack_index=1).pk, 6)  # Technical PK is still valid.
        self.assertEqual(sim.rack_set.get(rack_index=1).code, 'SIM-C01-R01')
        for stock in Stock.objects.select_related('bin__shelf__rack__cabinet'):
            self.assertIn(stock.bin.shelf.rack.cabinet.device_id, ['IPC01', 'IPCSIM01'])
        for op in Operation.objects.select_related('rack__cabinet', 'bin__shelf'):
            self.assertEqual(op.device_id, op.rack.cabinet.device_id)
            self.assertEqual(op.rack_id, op.bin.shelf.rack_id)

    def test_constraints_and_validator_reject_ambiguous_or_cross_device_mapping(self):
        sim = Cabinet.objects.get(device_id='IPCSIM01', cabinet_index=2)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Cabinet.objects.create(device=sim.device, domain='IPCSIM', code='duplicate', cabinet_index=2)
        for index in [1, 7]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                Rack.objects.create(cabinet=sim, address=999, rack_index=index)
        op = Operation.objects.filter(device_id='IPCSIM01').first()
        Operation.objects.filter(pk=op.pk).update(device_id='IPC01')
        with self.assertRaisesMessage(CommandError, 'mismatched location/device'):
            call_command('validate_locations', demo_topology=True, stdout=io.StringIO())

    def test_api_location_has_local_indices_and_explicit_source(self):
        user = User.objects.create_superuser('location-audit', '', 'test-password')
        self.client.force_login(user)
        response = self.client.get('/api/inventory-overview', {'source_type': 'SIMULATION'})
        self.assertEqual(response.status_code, 200)
        location = next(l for l in response.json()['locations'] if l['cabinet_index'] == 2 and l['rack_index'] == 1)
        self.assertEqual({k: location[k] for k in ['device_code', 'device_type', 'cabinet_code', 'cabinet_index', 'rack_code', 'rack_index']},
                         dict(device_code='IPCSIM01', device_type='SIMULATION', cabinet_code='SIM-C02', cabinet_index=2, rack_code='SIM-C02-R01', rack_index=1))
        self.assertEqual(location['serial_address'], 7)
        self.assertEqual(location['path'], 'IPCSIM01 / Cabinet 02 / Rack 01')

    def test_snapshot_projection_and_command_keep_wire_address_separate(self):
        from sqlalchemy import create_engine
        from ipc_core.app.database.database import Base
        from ipc_core.app.database.models import inventory, runtime, environment, auth, system
        from ipc_core.store import Store
        from ipc_core.projection import project
        from ipc_core.protocol import envelope, checksum
        device = Device.objects.get(pk='IPCSIM01')
        records = [r for r in records_for(device) if r['kind'] not in ['auth']]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'edge.sqlite3'
            engine = create_engine(f'sqlite:///{path}')
            Base.metadata.create_all(engine)
            engine.dispose()
            store = Store(path, device.pk, device.device_type)
            msg = envelope(device.pk, device.device_type, 'sync.full', dict(records=records, index=0, count=1, digest=checksum(records)), dataset_id=device.pk, revision=1, sync_id='location-test')
            store.apply(msg, project)
            cabinet = Cabinet.objects.get(device=device, cabinet_index=2)
            rack = cabinet.rack_set.get(rack_index=1)
            with store.transaction() as db:
                c = db.execute('SELECT * FROM cabinets WHERE id=?', (cabinet.pk,)).fetchone()
                r = db.execute('SELECT * FROM racks WHERE id=?', (rack.pk,)).fetchone()
                self.assertEqual(c['cabinet_index'], 2)
                self.assertEqual(r['rack_index'], 1)
                self.assertEqual(r['rack_code'], '7')  # Retained wire compatibility field.
                self.assertEqual(r['rack_identity_code'], 'SIM-C02-R01')
            # The command carries explicit rack PK and technical Serial address.
            commands = []
            store.execute_local('local-index-command', rack.pk, 'OPEN', lambda command: commands.append(command))
            self.assertEqual(commands[0]['rack_id'], rack.pk)
            self.assertEqual(commands[0]['address'], 7)
