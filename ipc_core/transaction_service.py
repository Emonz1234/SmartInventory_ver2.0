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
        self.recovery = None

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
        simulation_states = self.recovery.states() if self.recovery else []
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
            # Master cabinet.status describes configuration (e.g. "demo"),
            # not live availability. Simulation availability is checked below.
            if shelf['rack_id'] != data['rack_id'] or not item.get('is_active', True):
                raise ValueError('Invalid product or device location')
            inventory_service.validate(db, item['id'], location['id'], qty if kind=='PUT' else -qty, location.get('capacity', 0))
            open_rack = db.execute('SELECT evidence FROM local_rack_state WHERE rack_id=?', (rack['id'],)).fetchone()
            previous_open = None
            if self.recovery:
                states = simulation_states
                target = next((s for s in states if s['cabinet_index'] == (int(rack['rack_code'])-1)//6+1), None)
                if not target or not self._safe(target):
                    raise ValueError('Wait for a fresh, safe Simulation state')
                if any(s['cabinet_index'] != target['cabinet_index'] and
                       (s.get('active_rack') or s.get('active_command_id') or s.get('current_command')) and
                       not self._safe(s) for s in states):
                    raise ValueError('Resolve the other cabinet workflow before switching')
                known_open = db.execute('SELECT address FROM local_rack_state').fetchall()
                for known in known_open:
                    source = next((s for s in states if s['cabinet_index'] == (known['address']-1)//6+1), None)
                    if not source or not self._safe(source):
                        raise ValueError('Reconcile the previously open cabinet before switching')
                opened = [s for s in states if s.get('active_rack') and s['system_state'] == 'OPEN']
                if any(not self._safe(s) for s in opened):
                    raise ValueError('Resolve the open cabinet fault before switching')
                others = [s for s in opened if s['cabinet_index'] != target['cabinet_index']]
                if len(opened) > 1:
                    raise ValueError('Multiple open cabinets require operator reconciliation')
                previous_open = others[0] if others else None
                open_rack = {'evidence': json.dumps(self._endpoint(target, int(rack['rack_code']), True))} if target.get('active_rack') == int(rack['rack_code']) and target['system_state'] == 'OPEN' else None
            phase = 'OPEN_REUSED' if open_rack else 'OPEN'
            if previous_open:
                phase = 'CLOSE_PREVIOUS'
            status = 'AWAITING_CONFIRMATION' if open_rack else 'PREPARED'
            tid = str(uuid4())
            db.execute('''INSERT INTO local_transactions(transaction_id,request_key,ipc_id,operation_type,
                product_id,cabinet_id,rack_id,location_id,address,quantity,user_id,authorization,created_at,
                operation_status,phase,evidence)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (tid, key, self.store.device_id, kind, item['id'], cabinet['id'], rack['id'], location['id'], int(rack['rack_code']), qty, user_id, user['grant'], now(), status, phase, open_rack['evidence'] if open_rack else '{}'))
            if previous_open:
                db.execute('UPDATE local_transactions SET motion_address=?,motion_cabinet_id=? WHERE transaction_id=?',
                           (previous_open['active_rack'], previous_open['cabinet_index'], tid))
        if not open_rack:
            self.dispatch(tid, phase)
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
            if row['operation_status'] == 'EXECUTING' and row['phase'] == phase:
                return
            address = row['motion_address'] if phase == 'CLOSE_PREVIOUS' else row['address']
            command_id = f'{tid}:{phase}' if self.recovery else tid
            db.execute("UPDATE local_transactions SET operation_status='EXECUTING',phase=?,moving=0,motion_address=?,motion_command_id=?,motion_sent=0 WHERE transaction_id=?", (phase, address, command_id, tid))
        try:
            action = ('HOME' if self.recovery else 'CLOSE') if phase == 'CLOSE_PREVIOUS' else phase
            self.send({'rack_id': row['rack_id'], 'address': address, 'action': action, 'transaction_id': tid, 'command_id': command_id})
            with self.store.transaction() as db:
                db.execute('UPDATE local_transactions SET motion_sent=1 WHERE transaction_id=?', (tid,))
        except ValueError:
            with self.store.transaction() as db:
                db.execute("UPDATE local_transactions SET operation_status='PREPARED' WHERE transaction_id=? AND operation_status='EXECUTING'", (tid,))
            raise
        except Exception:
            with self.store.transaction() as db:
                db.execute("UPDATE local_transactions SET operation_status='UNCERTAIN',motion_sent=1 WHERE transaction_id=? AND operation_status='EXECUTING'", (tid,))
            raise ValueError('Serial result uncertain; inspect hardware, do not repeat the command') from None

    def confirm(self, user_id, tid, success, note, keep_open=False, decision_pending=False):
        self.auth.authorize(user_id, 'inventory.move')
        if not isinstance(note, str) or not note.strip():
            raise ValueError('Record the actual physical outcome')
        if type(keep_open) is not bool or (keep_open and not success):
            raise ValueError('keep_open requires a successful operation')
        simulation_states = self.recovery.states() if self.recovery else []
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM local_transactions WHERE transaction_id=?', (tid,)).fetchone()
            if not row:
                raise ValueError('Unknown local transaction')
            if row['operation_status'] in ('COMPLETED','FAILED','CANCELLED'):
                return dict(row)
            if row['operation_confirmed']:
                return dict(row)
            if success and row['operation_status'] != 'AWAITING_CONFIRMATION':
                raise ValueError('Wait for hardware OPEN completion; an uncertain operation cannot be auto-confirmed')
            if not success:
                db.execute("UPDATE local_transactions SET operation_status='CANCELLED',completed_at=?,note=? WHERE transaction_id=?", (now(), note, tid))
                return self._row(db, tid)
            if self.recovery:
                state = next((s for s in simulation_states if s['cabinet_index'] == (row['address']-1)//6+1), None)
                if not state or not self._safe(state) or state.get('active_rack') != row['address']:
                    raise ValueError('Wait for the target rack to be safely open before confirmation')
            evidence = json.loads(row['evidence'])
            if evidence.get('state') != -1 or evidence.get('is_endpoint') != 1 or evidence.get('displacement', 0) <= 0:
                raise ValueError('Successful OPEN evidence is required')
            self._apply_inventory(db, row)
            db.execute("UPDATE local_transactions SET operation_status='CONFIRMED',phase='DECISION',operation_confirmed=1,inventory_applied=1,note=? WHERE transaction_id=?", (note, tid))
        if not decision_pending:
            return self.finish(user_id, tid, 'KEEP_OPEN' if keep_open else 'CLOSE')
        return self.get(tid)

    def finish(self, user_id, tid, action):
        self.auth.authorize(user_id, 'inventory.move')
        if action not in {'KEEP_OPEN', 'CLOSE'}:
            raise ValueError('Choose KEEP_OPEN or CLOSE')
        simulation_states = self.recovery.states() if self.recovery else []
        with self.store.transaction() as db:
            row = self._row(db, tid)
            if row['operation_status'] == 'COMPLETED' or row['phase'] in {'CLOSE', 'HOME'}:
                return row
            if row['operation_status'] != 'CONFIRMED' or not row['inventory_applied']:
                raise ValueError('Confirm the physical inventory operation first')
            state = None
            if self.recovery:
                state = next((s for s in simulation_states if s['cabinet_index'] == (row['address']-1)//6+1), None)
                if not state or not self._safe(state):
                    raise ValueError('Wait for a safe Simulation state before finishing')
            if action == 'KEEP_OPEN':
                if state and state.get('active_rack') != row['address']:
                    raise ValueError('The transaction rack is no longer open')
                evidence = json.loads(row['evidence'])
                evidence['kept_open'] = True
                db.execute("UPDATE local_transactions SET operation_status='COMPLETED',phase='KEEP_OPEN',completed_at=?,evidence=? WHERE transaction_id=?", (now(), json.dumps(evidence), tid))
                return self._row(db, tid)
            if state and self._home_endpoint(state):
                db.execute("UPDATE local_transactions SET operation_status='COMPLETED',phase='CLOSE',completed_at=? WHERE transaction_id=?", (now(), tid))
                return self._row(db, tid)
            db.execute("UPDATE local_transactions SET operation_status='PREPARED' WHERE transaction_id=?", (tid,))
        self.dispatch(tid, 'HOME' if self.recovery else 'CLOSE')
        return self.get(tid)

    @staticmethod
    def _apply_inventory(db, row):
        if row['inventory_applied']:
            return
        inventory_service.apply(db, row['product_id'], row['location_id'], row['quantity'] if row['operation_type']=='PUT' else -row['quantity'])
        db.execute('INSERT INTO inventory_transactions(item_id,transaction_type,quantity,reference_no,user_id,created_at) VALUES(?,?,?,?,?,?)',
                   (row['product_id'], row['operation_type'], row['quantity'], row['transaction_id'], row['user_id'], now()))

    @staticmethod
    def _home_endpoint(state):
        racks = sorted(state.get('racks', {}).items(), key=lambda entry: int(entry[0]))
        return state['system_state'] == 'IDLE' and not state.get('active_rack') and state.get('current_gap') == 6 and len(racks) == 6 and all(abs(r['position_mm'] - i * 100) < 1e-6 and abs(r['target_position_mm'] - r['position_mm']) < 1e-6 for i, (_, r) in enumerate(racks))

    @staticmethod
    def _safe(state):
        return state.get('online') and state.get('system_state') in {'IDLE','OPEN','VENTILATED'} and not state.get('fault_context') and not state.get('active_command_id') and not state.get('pending_commands') and not any(r.get('is_moving') for r in state.get('racks', {}).values()) and state.get('sensors', {}).get('position_trusted') is True and not any(state.get('sensors', {}).get('faults', {}).values())

    @staticmethod
    def _endpoint(state, address, opened):
        return {'rack_id': address, 'state': -1, 'is_endpoint': 1, 'displacement': 64 if opened else 0, 'simulation': state}

    def reconcile(self, state):
        next_command = None
        with self.store.transaction() as db:
            group = state['cabinet_index']
            if self._safe(state):
                db.execute('DELETE FROM local_rack_state WHERE (address-1)/6=?', (group-1,))
            if self._safe(state) and state.get('active_rack'):
                for entry in db.execute('SELECT body FROM edge_records WHERE dataset=?', (self.store.device_id,)).fetchall():
                    record = json.loads(entry[0])
                    if record.get('kind') == 'rack' and str(record['data'].get('rack_code')) == str(state['active_rack']):
                        db.execute('INSERT OR REPLACE INTO local_rack_state VALUES(?,?,?,?)', (record['data']['id'], state['active_rack'], json.dumps(self._endpoint(state, state['active_rack'], True)), now()))
            row = self.repo.active(db)
            if row and state.get('online') and state.get('active_command_id') == row['motion_command_id'] and not state.get('fault_context'):
                db.execute("UPDATE local_transactions SET operation_status='EXECUTING' WHERE transaction_id=? AND operation_status='UNCERTAIN'", (row['transaction_id'],))
            if not row or (int(row['motion_address'] or row['address'])-1)//6+1 != group or not self._safe(state):
                return
            if row['operation_status'] == 'PREPARED':
                # This phase never reached Serial. Only a reconciled state after
                # the operator's recovery can authorize its first dispatch.
                next_command = (row['transaction_id'], row['phase'])
            elif row['phase'] in {'DECISION','OPEN_REUSED'}:
                if state.get('active_rack') == row['address']:
                    db.execute('UPDATE local_transactions SET operation_status=? WHERE transaction_id=?', ('CONFIRMED' if row['inventory_applied'] else 'AWAITING_CONFIRMATION', row['transaction_id']))
                return
            elif row['phase'] == 'RECOVERY_HOME' and self._home_endpoint(state):
                db.execute("UPDATE local_transactions SET operation_status='COMPLETED',moving=0,completed_at=?,evidence=? WHERE transaction_id=?", (now(), json.dumps(self._endpoint(state, row['address'], False)), row['transaction_id']))
                return
            elif state.get('last_command_id') not in {row['motion_command_id'], row['transaction_id']}:
                return
            elif row['phase'] == 'CLOSE_PREVIOUS' and self._home_endpoint(state):
                db.execute("UPDATE local_transactions SET operation_status='PREPARED',motion_address=address WHERE transaction_id=?", (row['transaction_id'],))
                next_command = (row['transaction_id'], 'OPEN')
            elif row['phase'] == 'OPEN' and state['system_state'] == 'OPEN' and state.get('active_rack') == row['address']:
                db.execute("UPDATE local_transactions SET operation_status='AWAITING_CONFIRMATION',moving=0,evidence=? WHERE transaction_id=?", (json.dumps(self._endpoint(state, row['address'], True)), row['transaction_id']))
            elif row['phase'] in {'CLOSE', 'HOME'} and state['system_state'] == 'IDLE' and not state.get('active_rack') and (row['phase'] != 'HOME' or self._home_endpoint(state)):
                # Compatibility for durable CLOSE journals created before
                # confirmation/inventory flags were introduced.
                self._apply_inventory(db, row)
                db.execute("UPDATE local_transactions SET operation_status='COMPLETED',operation_confirmed=1,inventory_applied=1,moving=0,completed_at=?,evidence=? WHERE transaction_id=?", (now(), json.dumps(self._endpoint(state, row['address'], False)), row['transaction_id']))
        if next_command:
            self.dispatch(*next_command)

    @staticmethod
    def _row(db, tid):
        row = db.execute('SELECT * FROM local_transactions WHERE transaction_id=?', (tid,)).fetchone()
        if not row:
            raise ValueError('Unknown local transaction')
        return dict(row)

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
                self._apply_inventory(db, row)
                db.execute("UPDATE local_transactions SET operation_status='COMPLETED',completed_at=?,evidence=?,sync_status='PENDING' WHERE transaction_id=?", (now(), json.dumps(payload), tid))

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
