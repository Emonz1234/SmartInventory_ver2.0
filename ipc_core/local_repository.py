"""Operational journal: independent of the replaceable Server master snapshot."""
import json
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def migrate(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS local_transactions (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id TEXT NOT NULL UNIQUE, request_key TEXT NOT NULL UNIQUE,
            ipc_id TEXT NOT NULL, operation_type TEXT NOT NULL,
            product_id INTEGER NOT NULL, cabinet_id INTEGER NOT NULL, rack_id INTEGER NOT NULL,
            location_id INTEGER NOT NULL, address INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
            user_id INTEGER NOT NULL, authorization TEXT NOT NULL,
            created_at TEXT NOT NULL, completed_at TEXT,
            operation_status TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'PENDING',
            retry_count INTEGER NOT NULL DEFAULT 0, last_sync_error TEXT NOT NULL DEFAULT '',
            last_attempt REAL NOT NULL DEFAULT 0, server_revision INTEGER,
            phase TEXT NOT NULL DEFAULT 'OPEN', moving INTEGER NOT NULL DEFAULT 0,
            evidence TEXT NOT NULL DEFAULT '{}', note TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS local_transactions_pending ON local_transactions(sync_status,sequence);
        CREATE TABLE IF NOT EXISTS local_rack_state (
            rack_id INTEGER PRIMARY KEY, address INTEGER NOT NULL,
            evidence TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_sync_state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS local_auth_attempts(username TEXT PRIMARY KEY, failures INTEGER NOT NULL, retry_after REAL NOT NULL);
        INSERT OR IGNORE INTO edge_migrations VALUES(2);
    ''')


class LocalRepository:
    def __init__(self, store):
        self.store = store

    def active(self, db):
        return db.execute("SELECT * FROM local_transactions WHERE operation_status NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY sequence LIMIT 1").fetchone()

    def master(self, db, kind, identity):
        row = db.execute('SELECT body FROM edge_records WHERE dataset=? AND key=?',
                         (self.store.device_id, f'{kind}:{identity}')).fetchone()
        if not row:
            raise ValueError(f'{kind} is not in the local device scope')
        return json.loads(row[0])['data']

    def transactions(self):
        with self.store.transaction() as db:
            result = []
            for row in db.execute('SELECT * FROM local_transactions ORDER BY sequence DESC LIMIT 200'):
                item = dict(row)
                item.pop('authorization')
                try:
                    cabinet = self.master(db, 'cabinet', item['cabinet_id'])
                    rack = self.master(db, 'rack', item['rack_id'])
                    if rack['cabinet_id'] != cabinet['id']:
                        raise ValueError('Historical rack mapping changed')
                    item.update(device_code=self.store.device_id,
                                device_type='REAL' if self.store.device_type == 'IPC' else 'SIMULATION',
                                cabinet_code=cabinet.get('cabinet_code'), cabinet_index=cabinet.get('cabinet_index'),
                                rack_code=rack.get('rack_identity_code'), rack_index=rack.get('rack_index'))
                except ValueError:
                    pass  # Preserve historical technical references when master rows were retired.

                item.update(id=item['transaction_id'], kind=item['operation_type'],
                            state={'COMPLETED': 'confirmed', 'FAILED': 'failed', 'CANCELLED': 'cancelled'}.get(item['operation_status'], item['operation_status'].lower()))
                result.append(item)
            return result

    def state(self):
        with self.store.transaction() as db:
            pending = db.execute("SELECT count(*) FROM local_transactions WHERE operation_status='COMPLETED' AND sync_status!='SYNCED'").fetchone()[0]
            error = db.execute("SELECT last_sync_error FROM local_transactions WHERE sync_status='FAILED' ORDER BY sequence LIMIT 1").fetchone()
            last = db.execute("SELECT value FROM local_sync_state WHERE key='last_successful_sync'").fetchone()
            return dict(pending_transactions=pending, sync_error=error[0] if error else '',
                        last_successful_sync=last[0] if last else None)

    def can_pull(self, db):
        return not self.active(db) and not db.execute("SELECT 1 FROM local_transactions WHERE operation_status='COMPLETED' AND sync_status!='SYNCED' LIMIT 1").fetchone()
