"""One local PUT/PICK state machine for both Serial adapters.

Legacy Serial has no transaction ID: require a movement followed by its endpoint
for OPEN, operator quantity confirmation, then CLOSE movement and endpoint.
No automatic re-execution after a crash or an ambiguous serial write.
"""
import json
from uuid import uuid4
from ipc_core.local_repository import LocalRepository, now
from ipc_core import inventory_service


class TransactionService:
    def __init__(self, store, auth, send):
        self.store, self.auth, self.send = store, auth, send
        self.repo = LocalRepository(store)

    def recover(self):
        with self.store.transaction() as db:
            db.execute("UPDATE local_transactions SET operation_status='UNCERTAIN', moving=0 WHERE operation_status IN ('PREPARED','EXECUTING','AWAITING_CONFIRMATION')")
            db.execute("UPDATE local_transactions SET sync_status='PENDING' WHERE sync_status='SYNCING'")

    def start(self, user_id, data):
        user = self.auth.authorize(user_id, 'inventory.move')
        kind, qty = data.get('kind'), data.get('quantity')
        if kind not in ('PUT', 'PICK') or type(qty) is not int or qty <= 0:
            raise ValueError('PUT/PICK requires a positive integer quantity')
        key = data.get('request_key')
        if not isinstance(key, str) or not 1 <= len(key) <= 128:
            raise ValueError('A stable request_key is required')
        with self.store.transaction() as db:
            previous = db.execute('SELECT * FROM local_transactions WHERE request_key=?', (key,)).fetchone()
            if previous:
                if (previous['user_id'], previous['operation_type'], previous['quantity'], previous['product_id'], previous['location_id'], previous['rack_id']) != (user_id, kind, qty, data.get('item_id'), data.get('bin_id'), data.get('rack_id')):
                    raise ValueError('Idempotency key reused for another operation')
                return dict(previous)
            if not self.store.revision(db=db):
                raise ValueError('Initial master synchronization required')
            if self.repo.active(db):
                raise ValueError('Resolve the active physical transaction first')
            if db.execute("SELECT 1 FROM edge_operations WHERE state IN ('sent','uncertain') LIMIT 1").fetchone():
                raise ValueError('Resolve the outstanding Server command before local inventory operations')
            rack = self.repo.master(db, 'rack', data['rack_id'])
            cabinet = self.repo.master(db, 'cabinet', rack['cabinet_id'])
            item = self.repo.master(db, 'item', data['item_id'])
            location = self.repo.master(db, 'bin', data['bin_id'])
            shelf = self.repo.master(db, 'shelf', location['shelf_id'])
            if shelf['rack_id'] != data['rack_id'] or not item.get('is_active', True) or cabinet.get('status') == 'pending_simulator':
                raise ValueError('Invalid product or device location')
            inventory_service.validate(db, item['id'], location['id'], qty if kind=='PUT' else -qty, location.get('capacity', 0))
            open_rack = db.execute('SELECT evidence FROM local_rack_state WHERE rack_id=?', (rack['id'],)).fetchone()
            phase = 'OPEN_REUSED' if open_rack else 'OPEN'
            status = 'AWAITING_CONFIRMATION' if open_rack else 'PREPARED'
            tid = str(uuid4())
            db.execute('''INSERT INTO local_transactions(transaction_id,request_key,ipc_id,operation_type,
                product_id,cabinet_id,rack_id,location_id,address,quantity,user_id,authorization,created_at,
                operation_status,phase,evidence)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (tid, key, self.store.device_id, kind, item['id'], cabinet['id'], rack['id'], location['id'], int(rack['rack_code']), qty, user_id, user['grant'], now(), status, phase, open_rack['evidence'] if open_rack else '{}'))
        if not open_rack:
            self.dispatch(tid, 'OPEN')
        return self.get(tid)

    def get(self, tid):
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM local_transactions WHERE transaction_id=?', (tid,)).fetchone()
            if not row:
                raise ValueError('Unknown local transaction')
            return dict(row)

    def dispatch(self, tid, phase):
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM local_transactions WHERE transaction_id=?', (tid,)).fetchone()
            db.execute("UPDATE local_transactions SET operation_status='EXECUTING',phase=?,moving=0 WHERE transaction_id=?", (phase, tid))
        try:
            self.send({'rack_id': row['rack_id'], 'address': row['address'], 'action': phase, 'transaction_id': tid})
        except Exception:
            with self.store.transaction() as db:
                db.execute("UPDATE local_transactions SET operation_status='UNCERTAIN' WHERE transaction_id=? AND operation_status='EXECUTING'", (tid,))
            raise ValueError('Serial result uncertain; inspect hardware, do not repeat the command') from None

    def confirm(self, user_id, tid, success, note, keep_open=False):
        self.auth.authorize(user_id, 'inventory.move')
        if not isinstance(note, str) or not note.strip():
            raise ValueError('Record the actual physical outcome')
        if type(keep_open) is not bool or (keep_open and not success):
            raise ValueError('keep_open requires a successful operation')
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM local_transactions WHERE transaction_id=?', (tid,)).fetchone()
            if not row:
                raise ValueError('Unknown local transaction')
            if row['operation_status'] in ('COMPLETED','FAILED','CANCELLED'):
                return dict(row)
            if success and row['operation_status'] != 'AWAITING_CONFIRMATION':
                raise ValueError('Wait for hardware OPEN completion; an uncertain operation cannot be auto-confirmed')
            if not success:
                db.execute("UPDATE local_transactions SET operation_status='CANCELLED',completed_at=?,note=? WHERE transaction_id=?", (now(), note, tid))
                return self._row(db, tid)
            if keep_open:
                evidence = json.loads(row['evidence'])
                if evidence.get('state') != -1 or evidence.get('is_endpoint') != 1 or not isinstance(evidence.get('displacement'), (int, float)) or evidence['displacement'] <= 0:
                    raise ValueError('Cannot keep a rack open without successful OPEN endpoint evidence')
                evidence['kept_open'] = True
                completed_at = now()
                inventory_service.apply(db, row['product_id'], row['location_id'], row['quantity'] if row['operation_type'] == 'PUT' else -row['quantity'])
                db.execute("UPDATE local_transactions SET operation_status='COMPLETED',phase='KEEP_OPEN',completed_at=?,evidence=?,note=?,sync_status='PENDING' WHERE transaction_id=?",
                           (completed_at, json.dumps(evidence), note, tid))
                db.execute('INSERT INTO inventory_transactions(item_id,transaction_type,quantity,reference_no,user_id,created_at) VALUES(?,?,?,?,?,?)',
                           (row['product_id'], row['operation_type'], row['quantity'], tid, row['user_id'], completed_at))
                return self._row(db, tid)
            db.execute('UPDATE local_transactions SET note=? WHERE transaction_id=?', (note, tid))
            # Claim the close transition while locked; concurrent confirms cannot send twice.
            db.execute("UPDATE local_transactions SET operation_status='PREPARED' WHERE transaction_id=?", (tid,))
        self.dispatch(tid, 'CLOSE')
        return self.get(tid)

    @staticmethod
    def _row(db, tid):
        return dict(db.execute('SELECT * FROM local_transactions WHERE transaction_id=?', (tid,)).fetchone())

    def observe(self, payload):
        with self.store.transaction() as db:
            row = self.repo.active(db)
            if not row:
                self._observe_idle_rack(db, payload)
                return
            if row['operation_status'] != 'EXECUTING' or payload.get('rack_id') != row['address']:
                return
            if payload.get('transaction_id') and payload['transaction_id'] != row['transaction_id']:
                return
            tid = row['transaction_id']
            if any(payload.get(k) for k in ('is_obstructed','is_skewed','is_overload_motor')):
                db.execute("UPDATE local_transactions SET operation_status='FAILED',completed_at=?,evidence=? WHERE transaction_id=?", (now(), json.dumps(payload), tid))
                return
            expected = 1 if row['phase']=='OPEN' else 2
            if payload.get('state') == expected:
                db.execute('UPDATE local_transactions SET moving=1 WHERE transaction_id=?', (tid,))
                return
            pos = payload.get('displacement')
            endpoint = payload.get('state') == -1 and payload.get('is_endpoint') == 1
            endpoint = endpoint and isinstance(pos, (int,float)) and (pos>0 if expected==1 else pos==0)
            if not row['moving'] or not endpoint:
                return
            if row['phase']=='OPEN':
                db.execute('INSERT OR REPLACE INTO local_rack_state(rack_id,address,evidence,updated_at) VALUES(?,?,?,?)',
                           (row['rack_id'], row['address'], json.dumps(payload), now()))
                db.execute("UPDATE local_transactions SET operation_status='AWAITING_CONFIRMATION',moving=0,evidence=? WHERE transaction_id=?", (json.dumps(payload), tid))
            else:
                db.execute('DELETE FROM local_rack_state WHERE rack_id=?', (row['rack_id'],))
                inventory_service.apply(db, row['product_id'], row['location_id'], row['quantity'] if row['operation_type']=='PUT' else -row['quantity'])
                db.execute("UPDATE local_transactions SET operation_status='COMPLETED',completed_at=?,evidence=?,sync_status='PENDING' WHERE transaction_id=?", (now(), json.dumps(payload), tid))
                db.execute('INSERT INTO inventory_transactions(item_id,transaction_type,quantity,reference_no,user_id,created_at) VALUES(?,?,?,?,?,?)',
                           (row['product_id'], row['operation_type'], row['quantity'], tid, row['user_id'], now()))

    def _observe_idle_rack(self, db, payload):
        address = payload.get('rack_id')
        displacement = payload.get('displacement')
        if payload.get('state') != -1 or payload.get('is_endpoint') != 1 or not isinstance(displacement, (int, float)):
            return
        matches = []
        for record_row in db.execute('SELECT body FROM edge_records WHERE dataset=?', (self.store.device_id,)):
            record = json.loads(record_row['body'])
            if record.get('kind') == 'rack' and str(record.get('data', {}).get('rack_code')) == str(address):
                matches.append(record['data'])
        if len(matches) != 1:
            return
        rack_id = matches[0]['id']
        if displacement > 0:
            db.execute('INSERT OR REPLACE INTO local_rack_state(rack_id,address,evidence,updated_at) VALUES(?,?,?,?)',
                       (rack_id, address, json.dumps(payload), now()))
        elif displacement == 0:
            db.execute('DELETE FROM local_rack_state WHERE rack_id=?', (rack_id,))
