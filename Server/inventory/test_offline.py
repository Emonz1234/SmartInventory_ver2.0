"""End-to-end business tests with real SQLite and Server MQTT envelopes."""
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.test import TestCase
from sqlalchemy import create_engine
from ipc_core.app.database.database import Base
from ipc_core.app.database.models import inventory, environment, runtime as runtime_models, auth, system
from ipc_core.runtime import Runtime
from ipc_core.protocol import envelope, encode, topic, checksum
from ipc_core.projection import project
from ipc_core.sync_service import transaction_payload
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Outbox, PhysicalTransaction, Ledger
from .services import refresh, full_snapshot
from .mqtt import receive


class OfflineWorkflowTests(TestCase):
    device_kind = 'IPCSIM'
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.user = get_user_model().objects.create_superuser('offline-operator', '', 'offline-password')
        self.device = Device.objects.create(device_id='offline-sim', device_type=self.device_kind, name='SIM')
        cabinet = Cabinet.objects.create(device=self.device, code='1', name='Cabinet', domain=self.device_kind)
        self.rack = Rack.objects.create(cabinet=cabinet, address=1)
        shelf = Shelf.objects.create(rack=self.rack, code='S1')
        self.bin = Bin.objects.create(shelf=shelf, code='B1', capacity=100)
        self.item = Item.objects.create(code='ITEM', name='Item', unit='pcs')
        Stock.objects.create(item=self.item, bin=self.bin, quantity=10)
        refresh(self.device)
        path = Path(self.directory.name)/'edge.db'
        engine = create_engine(f'sqlite:///{path.as_posix()}')
        Base.metadata.create_all(engine)
        engine.dispose()
        self.writes = []
        self.cfg = SimpleNamespace(DB_PATH=str(path), DEVICE_ID=self.device.pk, DEVICE_TYPE=self.device_kind,
                       MQTT_HOST='')
        self.serial = SimpleNamespace(connected=True, send_domain=lambda command: self.writes.append(command))
        self.edge = Runtime(self.cfg, self.serial)
        self.handshake()
        self.deliver_snapshot()

    def down(self, msg):
        self.edge.receive(topic(self.device.pk, 'down', msg['message_type'].split('.')[0]), encode(msg))

    def up(self, msg):
        receive(topic(self.device.pk, 'up', msg['message_type'].split('.')[0]), encode(msg))

    def handshake(self):
        self.edge.sync.connected()
        self.up(self.edge.sync.next_message())
        # UUID ordering is not chronological: select this connection's nonce explicitly.
        msg = Outbox.objects.get(body__message_type='status.ready', body__payload__nonce=self.edge.sync.nonce).body
        self.down(msg)

    def deliver_snapshot(self):
        self.device.refresh_from_db()
        full_snapshot(self.device)
        rows = Outbox.objects.filter(body__message_type='sync.full', body__revision=self.device.revision)
        for row in rows:
            self.down(row.body)

    def qty(self):
        with self.edge.store.transaction() as db:
            return db.execute('SELECT quantity FROM item_locations WHERE item_id=? AND bin_id=?', (self.item.pk,self.bin.pk)).fetchone()[0]

    def test_login_does_not_lock_after_repeated_invalid_passwords(self):
        for _ in range(6):
            with self.assertRaisesMessage(ValueError, 'Invalid credentials or user not yet synchronized'):
                self.edge.auth.login('offline-operator', 'wrong-password')

    def test_user_without_edge_permission_is_synced_for_login(self):
        viewer = get_user_model().objects.create_user('viewer', password='viewer-password')
        refresh(self.device)
        auth_record = next(record for record in self.device.snapshot if record['key'] == f'auth:{viewer.pk}')
        self.assertEqual(auth_record['data']['username'], 'viewer')
        self.assertEqual(auth_record['data']['permissions'], [])

    def begin(self, kind='PICK', quantity=2, key='request-1'):
        return self.edge.transactions.start(self.user.pk, dict(kind=kind, quantity=quantity,
            request_key=key, item_id=self.item.pk, bin_id=self.bin.pk, rack_id=self.rack.pk))

    def physical(self, phase):
        state = 1 if phase=='OPEN' else 2
        self.edge.transactions.observe({'rack_id':1,'state':state})
        self.edge.transactions.observe({'rack_id':1,'state':-1,'is_endpoint':1,'displacement':20 if phase=='OPEN' else 0})

    def complete(self, kind='PICK', quantity=2, key='request-1'):
        tx = self.begin(kind, quantity, key)
        self.physical('OPEN')
        self.edge.transactions.confirm(self.user.pk, tx['transaction_id'], True, 'Count verified')
        self.physical('CLOSE')
        return self.edge.transactions.get(tx['transaction_id'])

    def replay_one(self, lose_ack=False):
        with self.edge.store.transaction() as db:
            db.execute('UPDATE local_transactions SET last_attempt=0')
        message = self.edge.sync.next_message()
        self.assertEqual(message['message_type'], 'events.transaction')
        self.up(message)
        ack = Outbox.objects.get(body__message_type='ack.transaction', body__correlation_id=message['message_id']).body
        if not lose_ack:
            self.down(ack)
        return message, ack

    def test_online_commit_then_ack_and_reconcile(self):
        self.edge.connected = True
        self.complete()
        self.assertEqual(self.qty(), 8)
        self.assertEqual(Stock.objects.get(item=self.item).quantity, 10)
        self.replay_one()
        self.deliver_snapshot()
        self.assertEqual(self.qty(), 8)
        self.assertEqual(Stock.objects.get(item=self.item).quantity, 8)
        self.assertEqual(self.edge.sync.repo.state()['pending_transactions'], 0)

    def test_keep_open_commits_and_reuses_open_rack_without_another_open_command(self):
        first = self.begin(key='keep-open')
        self.physical('OPEN')
        completed = self.edge.transactions.confirm(self.user.pk, first['transaction_id'], True, 'Count verified', keep_open=True)
        self.assertEqual(completed['operation_status'], 'COMPLETED')
        self.assertTrue(json.loads(completed['evidence'])['kept_open'])
        self.assertEqual(self.qty(), 8)
        self.assertEqual([command['action'] for command in self.writes], ['OPEN'])

        second = self.begin('PUT', 1, 'same-rack-reuse')
        self.assertEqual(second['operation_status'], 'AWAITING_CONFIRMATION')
        self.assertEqual(second['phase'], 'OPEN_REUSED')
        self.assertEqual([command['action'] for command in self.writes], ['OPEN'])
        self.edge.transactions.confirm(self.user.pk, second['transaction_id'], True, 'Placed in same rack')
        self.assertEqual(self.writes[-1]['action'], 'CLOSE')
        self.physical('CLOSE')
        self.assertEqual(self.qty(), 9)

        first_message, _ = self.replay_one()
        self.assertTrue(json.loads(first_message['payload']['evidence'])['kept_open'])
        self.replay_one()
        self.assertEqual(Stock.objects.get(item=self.item).quantity, 9)

    def test_offline_login_operations_and_ordered_reconnect(self):
        self.edge.sync.disconnected()
        self.assertEqual(self.edge.auth.login('offline-operator','offline-password')['id'], self.user.pk)
        self.complete('PUT', 3, 'put')
        self.complete('PICK', 4, 'pick')
        self.assertEqual(self.qty(), 9)
        self.handshake()
        first, _ = self.replay_one()
        self.assertEqual(first['payload']['operation_type'], 'PUT')
        second, _ = self.replay_one()
        self.assertEqual(second['payload']['operation_type'], 'PICK')
        self.deliver_snapshot()
        self.assertEqual(self.qty(), Stock.objects.get(item=self.item).quantity)
        self.assertEqual(Ledger.objects.count(), 2)

    def test_duplicate_and_lost_ack_apply_once_after_server_restart(self):
        tx = self.complete()
        message, ack = self.replay_one(lose_ack=True)
        self.up(message)
        self.assertEqual(Stock.objects.get(item=self.item).quantity, 8)
        self.assertEqual(PhysicalTransaction.objects.count(), 1)
        self.assertEqual(Ledger.objects.count(), 1)
        self.handshake()  # no worker-memory dependency
        self.replay_one()
        self.assertEqual(self.edge.transactions.get(tx['transaction_id'])['sync_status'], 'SYNCED')

    def test_ipc_restart_preserves_pending_transaction_and_local_auth(self):
        tx = self.complete()
        self.edge = Runtime(self.cfg, self.serial)
        self.assertEqual(self.qty(), 8)
        self.assertEqual(self.edge.auth.login('offline-operator','offline-password')['id'], self.user.pk)
        self.assertEqual(self.edge.transactions.get(tx['transaction_id'])['sync_status'], 'PENDING')
        self.handshake()
        self.replay_one()
        self.deliver_snapshot()
        self.assertEqual(self.qty(), 8)

    def test_master_cannot_overwrite_unacknowledged_physical_stock(self):
        self.complete()
        self.deliver_snapshot()
        self.assertEqual(self.qty(), 8)
        self.assertEqual(self.edge.sync.repo.state()['pending_transactions'], 1)
        self.replay_one()
        self.deliver_snapshot()
        self.assertEqual(self.qty(), 8)
        self.assertTrue(self.edge.sync.repo.state()['last_successful_sync'])

    def test_hardware_failure_and_cancel_do_not_change_inventory(self):
        tx = self.begin()
        self.edge.transactions.observe({'rack_id':1,'is_obstructed':True})
        self.assertEqual(self.qty(), 10)
        self.assertEqual(self.edge.transactions.get(tx['transaction_id'])['operation_status'], 'FAILED')
        tx = self.begin(key='cancelled')
        self.edge.transactions.confirm(self.user.pk, tx['transaction_id'], False, 'Cancelled before taking goods')
        self.physical('CLOSE')
        self.assertEqual(self.qty(), 10)

    def test_idle_endpoint_and_user_click_cannot_commit_stock(self):
        tx = self.begin()
        self.edge.transactions.observe({'rack_id':1,'state':-1,'is_endpoint':1,'displacement':20})
        with self.assertRaises(ValueError):
            self.edge.transactions.confirm(self.user.pk, tx['transaction_id'], True, 'Clicked')
        self.assertEqual(self.qty(), 10)
        self.physical('OPEN')
        self.edge.transactions.confirm(self.user.pk, tx['transaction_id'], True, 'Counted')
        self.assertEqual(self.qty(), 10)
        self.physical('CLOSE')
        self.physical('CLOSE')
        self.assertEqual(self.qty(), 8)

    def test_conflict_retains_evidence_and_retry_after_baseline_reconcile(self):
        tx = self.complete()
        Stock.objects.filter(item=self.item).update(quantity=0)
        _, ack = self.replay_one()
        self.assertEqual(ack['payload']['status'], 'CONFLICT')
        self.assertEqual(self.edge.transactions.get(tx['transaction_id'])['sync_status'], 'FAILED')
        self.deliver_snapshot()
        self.assertEqual(self.qty(), 8)
        Stock.objects.filter(item=self.item).update(quantity=10)
        self.replay_one()
        self.deliver_snapshot()
        self.assertEqual(self.qty(), 8)
        self.assertEqual(PhysicalTransaction.objects.get().status, 'APPLIED')

    def test_tampered_ack_and_duplicate_id_payload_are_rejected(self):
        tx = self.complete()
        message, ack = self.replay_one(lose_ack=True)
        ack['payload']['digest'] = 'wrong'
        with self.assertRaises(ValueError):
            self.down(ack)
        message['payload']['quantity'] = 3
        with self.assertRaises(ValueError):
            self.up(message)
        self.assertNotEqual(self.edge.transactions.get(tx['transaction_id'])['sync_status'], 'SYNCED')

    def test_uncertain_restart_never_reexecutes_hardware(self):
        tx = self.begin()
        writes = len(self.writes)
        self.edge = Runtime(self.cfg, self.serial)
        self.assertEqual(self.edge.transactions.get(tx['transaction_id'])['operation_status'], 'UNCERTAIN')
        with self.assertRaises(ValueError):
            self.edge.transactions.confirm(self.user.pk, tx['transaction_id'], True, 'No evidence')
        self.assertEqual(len(self.writes), writes)
        self.assertEqual(self.qty(), 10)

    def test_ipc_and_ipcsim_share_the_same_business_result(self):
        from ipc_core.adapters import adapter_for
        for kind in ('IPC','IPCSIM'):
            self.cfg.DEVICE_TYPE = kind
            # The only variation is the wire encoder; business state machine remains the same.
            adapter = adapter_for(kind)
            encoded = []
            self.edge.transactions.send = lambda command: encoded.append(adapter.encode(command))
            self.complete('PUT', 1, kind)
            self.assertEqual(len(encoded), 2)
        self.assertEqual(self.qty(), 12)

    def test_passwords_and_grants_are_not_in_public_snapshot(self):
        data = json.dumps(self.edge.store.public_records())
        self.assertNotIn('password_hash', data)
        self.assertNotIn('grant', data)

    def test_auth_revocation_applies_on_next_master_sync(self):
        self.user.is_active = False
        self.user.save()
        self.handshake()
        self.deliver_snapshot()
        with self.assertRaises(ValueError):
            self.edge.auth.login('offline-operator','offline-password')

    def test_revision_equal_reconnect_does_not_resend_entire_snapshot(self):
        before = Outbox.objects.filter(body__message_type='sync.full').count()
        self.up(self.edge.sync.next_message())
        self.assertEqual(Outbox.objects.filter(body__message_type='sync.full').count(), before)
        self.assertTrue(Outbox.objects.filter(body__message_type='status.reconciled').exists())


class OfflineHardwareWorkflowTests(OfflineWorkflowTests):
    device_kind = 'IPC'
