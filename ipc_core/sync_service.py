"""Reconnect barrier: handshake -> ordered journal replay -> ACK -> master reconcile."""
import json
import time
from uuid import uuid4
from ipc_core.local_repository import LocalRepository, now
from ipc_core.protocol import envelope, checksum


FIELDS = ('transaction_id','ipc_id','operation_type','product_id','cabinet_id','rack_id',
          'location_id','quantity','user_id','authorization','created_at','completed_at','evidence','note')


def transaction_payload(row):
    return {key: row[key] for key in FIELDS}


class SyncService:
    def __init__(self, store):
        self.store, self.repo = store, LocalRepository(store)
        self.nonce, self.ready, self.requested_at, self.hello_at = '', False, 0, 0
        self.full_required = False

    def connected(self):
        self.nonce, self.ready, self.requested_at = str(uuid4()), False, 0
        self.hello_at = 0

    def disconnected(self):
        self.ready = False
        with self.store.transaction() as db:
            db.execute("UPDATE local_transactions SET sync_status='PENDING',last_sync_error='MQTT disconnected; awaiting reconnect' WHERE sync_status='SYNCING'")

    def handshake(self, payload):
        if payload.get('nonce') != self.nonce:
            return
        self.ready, self.requested_at = True, 0

    def next_message(self):
        stamp = time.time()
        if not self.ready or stamp-self.hello_at >= 60:
            if stamp-self.hello_at < 5:
                return None
            self.ready = False
            self.hello_at = stamp
            return envelope(self.store.device_id, self.store.device_type, 'status.hello',
                            {'nonce': self.nonce, 'revision': self.store.revision()})
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM local_transactions WHERE operation_status='COMPLETED' AND sync_status!='SYNCED' ORDER BY sequence LIMIT 1").fetchone()
            if row:
                self.requested_at = 0
                if stamp-row['last_attempt'] < min(60, 2**min(row['retry_count'], 5)):
                    return None
                payload = transaction_payload(row)
                db.execute("UPDATE local_transactions SET sync_status='SYNCING',retry_count=retry_count+1,last_attempt=? WHERE transaction_id=?", (stamp, row['transaction_id']))
                msg = envelope(self.store.device_id, self.store.device_type, 'events.transaction', payload)
                msg['message_id'] = row['transaction_id']
                return msg
            if self.repo.can_pull(db) and stamp-self.requested_at > 15:
                self.requested_at = stamp
                floor = db.execute('SELECT COALESCE(max(server_revision),0) FROM local_transactions').fetchone()[0]
                return envelope(self.store.device_id, self.store.device_type, 'sync.error' if self.full_required else 'sync.request',
                                {'offline_protocol': 1, 'minimum_revision': floor},
                                dataset_id=self.store.device_id, revision=self.store.revision(db=db))
        return None

    def acknowledge(self, message):
        payload = message['payload']
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM local_transactions WHERE transaction_id=? AND operation_status='COMPLETED'", (message.get('correlation_id'),)).fetchone()
            if not row or payload.get('digest') != checksum(transaction_payload(row)):
                raise ValueError('Transaction ACK does not match durable physical evidence')
            if row['sync_status'] == 'SYNCED':
                return
            if payload.get('status') != 'APPLIED':
                db.execute("UPDATE local_transactions SET sync_status='FAILED',last_sync_error=? WHERE transaction_id=?", (payload.get('error','Server rejected transaction'), row['transaction_id']))
                return
            revision = payload.get('revision')
            if type(revision) is not int or revision < 1:
                raise ValueError('Invalid ACK revision')
            db.execute("UPDATE local_transactions SET sync_status='SYNCED',server_revision=?,last_sync_error='' WHERE transaction_id=?", (revision, row['transaction_id']))
            self.requested_at = 0

    def accept_master(self, message):
        if not self.ready:
            return False
        with self.store.transaction() as db:
            minimum = db.execute('SELECT COALESCE(max(server_revision),0) FROM local_transactions').fetchone()[0]
            return self.repo.can_pull(db) and message['revision'] >= minimum

    def reconciled(self):
        self.full_required = False
        with self.store.transaction() as db:
            db.execute("INSERT OR REPLACE INTO local_sync_state VALUES('last_successful_sync',?)", (now(),))

    def failed(self, tid, error):
        with self.store.transaction() as db:
            db.execute("UPDATE local_transactions SET sync_status='FAILED',last_sync_error=? WHERE transaction_id=? AND sync_status!='SYNCED'", (str(error), tid))
