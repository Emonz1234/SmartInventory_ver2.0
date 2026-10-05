"""Durable Simulation mechanical state. Independent of Server master sync."""
import json
import math
import time
from uuid import uuid4
from ipc_core.protocol import canonical

LOCKED = {'ERROR', 'RECOVERING', 'STOPPED', 'COMMUNICATION_LOST'}


class RecoveryService:
    def __init__(self, store, serial):
        self.store, self.serial = store, serial
        self.session = str(uuid4())
        self.requests, self.last_poll = {}, {}
        self.live = set()
        self.single_group = None
        self.discovery_cursor = 0
        self.discovery_at = 0
        with store.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS simulation_state(
                    cabinet_index INTEGER PRIMARY KEY, body TEXT NOT NULL, received_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS simulation_history(
                    id INTEGER PRIMARY KEY, cabinet_index INTEGER, timestamp REAL, event TEXT, body TEXT);
                CREATE TABLE IF NOT EXISTS simulation_event_receipts(
                    event_key TEXT PRIMARY KEY);
            ''')

    def states(self):
        with self.store.transaction() as db:
            result = []
            for row in db.execute('SELECT * FROM simulation_state ORDER BY cabinet_index'):
                state = json.loads(row['body'])
                online = state['cabinet_index'] in self.live and time.time() - row['received_at'] < 8
                state['online'] = online
                if not online:
                    state['system_state'] = 'COMMUNICATION_LOST'
                    state['allowed_actions'] = []
                result.append(state)
            return result

    def groups(self):
        return sorted({(int(r['data']['rack_code']) - 1)//6 + 1
                       for r in self.store.records() if r['kind'] == 'rack'})

    def link(self, group):
        links = getattr(self.serial, 'links', None)
        return links.get(group) if links is not None else self.serial

    def send(self, group, operation, **data):
        link = self.link(group)
        if link is None or not link.connected:
            raise ValueError('Simulation Serial is offline')
        request_id = str(uuid4())
        body = dict(protocol_version=2, cabinet_index=group, peer_session=self.session,
                    operation=operation, request_id=request_id, **data)
        self.requests[group] = request_id
        if operation == 'EXECUTE':
            with self.store.transaction() as db:
                row = db.execute('SELECT body FROM simulation_state WHERE cabinet_index=?', (group,)).fetchone()
                if row:
                    state = json.loads(row[0])
                    state['active_command_id'] = data['command_id']
                    state['command_pending'] = True
                    db.execute('UPDATE simulation_state SET body=? WHERE cabinet_index=?', (canonical(state), group))
        link.send(canonical(body))
        return request_id

    def poll(self, group=None):
        groups = [group] if group is not None else self.groups()
        if group is None and not hasattr(self.serial, 'links'):
            if self.single_group is not None:
                groups = [self.single_group]
            elif groups:
                if time.monotonic() - self.discovery_at < .5:
                    return
                self.discovery_at = time.monotonic()
                groups = [groups[self.discovery_cursor % len(groups)]]
                self.discovery_cursor += 1
        for index in groups:
            link = self.link(index)
            if link is None or not link.connected:
                self.lost(index)
                continue
            if time.monotonic() - self.last_poll.get(index, 0) >= 2:
                self.last_poll[index] = time.monotonic()
                self.send(index, 'REQUEST_STATE')
            with self.store.transaction() as db:
                row = db.execute('SELECT received_at FROM simulation_state WHERE cabinet_index=?', (index,)).fetchone()
            if row and time.time() - row[0] >= 8:
                self.lost(index)

    def lost(self, group=None):
        groups = [group] if group is not None else self.groups()
        with self.store.transaction() as db:
            for index in groups:
                self.live.discard(index)
                row = db.execute('SELECT body FROM simulation_state WHERE cabinet_index=?', (index,)).fetchone()
                if not row:
                    continue
                state = json.loads(row[0])
                if state['system_state'] == 'COMMUNICATION_LOST':
                    continue
                state['previous_state'] = state['system_state']
                state['system_state'] = 'COMMUNICATION_LOST'
                state['allowed_actions'] = []
                if not state.get('fault_context'):
                    state['fault_context'] = dict(error_code='COMMUNICATION_LOST',
                                                 command_id=state.get('active_command_id'),
                                                 previous_state=state['previous_state'],
                                                 snapshot=state.get('racks'), timestamp=time.time())
                db.execute('UPDATE simulation_state SET body=? WHERE cabinet_index=?', (canonical(state), index))
                self._history(db, index, 'communication_lost', state)
                db.execute("UPDATE local_transactions SET operation_status='UNCERTAIN' WHERE operation_status='EXECUTING' AND (address-1)/6=?", (index-1,))

    @staticmethod
    def _history(db, group, event, state):
        db.execute('INSERT INTO simulation_history(cabinet_index,timestamp,event,body) VALUES(?,?,?,?)',
                   (group, time.time(), event, canonical(state)))

    def receive(self, payload):
        group = payload.get('cabinet_index')
        if type(group) is not int or group not in self.groups():
            raise ValueError('Simulation snapshot outside local assignment')
        if payload.get('peer_session') != self.session:
            # Unsolicited snapshots identify the group on a single physical link;
            # only a reply carrying our session can make it ready for commands.
            if not hasattr(self.serial, 'links') and payload.get('peer_session') is None:
                self.single_group = group
            return False
        if not isinstance(payload.get('boot_id'), str) or type(payload.get('sequence')) is not int:
            raise ValueError('Invalid simulation session/sequence')
        racks = payload.get('racks')
        addresses = set(range((group-1)*6+1, group*6+1))
        if not isinstance(racks, dict) or {int(k) for k in racks} != addresses:
            raise ValueError('Snapshot rack topology mismatch')
        positions = []
        for address in sorted(addresses):
            rack = racks.get(str(address), racks.get(address))
            for key in ('position_mm', 'target_position_mm', 'progress_percent'):
                value = rack.get(key)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise ValueError('Snapshot position must be finite')
            positions.append(rack['position_mm'])
        if any(p < 0 or p > 600 for p in positions) or any(b-a < 100-1e-6 for a,b in zip(positions, positions[1:])):
            raise ValueError('Unsafe mechanical snapshot')
        state = dict(payload)
        context = state.get('fault_context')
        sensors = state.get('sensors', {})
        faults = any(sensors.get('faults', {}).values())
        if state.get('system_state') not in {'IDLE', 'OPENING', 'OPEN', 'CLOSING', 'MOVING', 'STOPPED', 'ERROR', 'RECOVERING', 'VENTILATED'}:
            raise ValueError('Unknown mechanical state')
        actions = []
        stopped = not any(r.get('is_moving') for r in racks.values())
        if context and context.get('cleared') and not faults and stopped:
            classification = context.get('classification')
            if classification != 'FATAL':
                actions = ['ABORT', 'HOME']
                if classification in {'RECOVERABLE', 'REQUIRES_CONFIRMATION'} and sensors.get('position_trusted') is True:
                    actions.insert(0, 'RESUME')
        state['allowed_actions'] = actions if state.get('system_state') in LOCKED else []
        with self.store.transaction() as db:
            row = db.execute('SELECT body FROM simulation_state WHERE cabinet_index=?', (group,)).fetchone()
            previous = json.loads(row[0]) if row else None
            if previous and previous.get('boot_id') != state['boot_id']:
                retired = db.execute("SELECT body FROM simulation_history WHERE cabinet_index=? AND event='simulation_restarted'", (group,))
                if any(json.loads(entry[0]).get('boot_id') == state['boot_id'] for entry in retired):
                    return False
            if previous and previous.get('boot_id') == state['boot_id'] and state['sequence'] <= previous['sequence']:
                return False
            if state.get('active_command_id'):
                same_command = previous and previous.get('active_command_id') == state['active_command_id']
                resumed = previous and previous.get('system_state') in LOCKED and state['system_state'] not in LOCKED
                state['operation_started_at'] = previous.get('operation_started_at', time.time()) if same_command and not resumed else time.time()
            restarted = previous and previous.get('boot_id') != state['boot_id']
            clean_home = (state['system_state'] == 'IDLE' and state.get('current_gap') == 6
                          and not context and not faults and stopped
                          and sensors.get('position_trusted') is True
                          and not state.get('active_command_id') and not state.get('pending_commands')
                          and not state.get('active_rack')
                          and all(abs(p - i * 100) < 1e-6 for i, p in enumerate(positions))
                          and all(abs(r['target_position_mm'] - r['position_mm']) < 1e-6 for r in racks.values()))
            if restarted and clean_home:
                # A new simulator starts at HOME. Archive interrupted work without
                # committing inventory or replaying commands from its previous boot.
                self._history(db, group, 'simulation_restarted', previous)
                db.execute("UPDATE local_transactions SET operation_status='CANCELLED',moving=0,note='Simulation restarted at HOME; interrupted operation cancelled without inventory commit' WHERE operation_status IN ('EXECUTING','AWAITING_CONFIRMATION','UNCERTAIN') AND (address-1)/6=?", (group-1,))
            # Unexpected resets or command changes still require reconciliation.
            mismatch = previous and previous.get('active_command_id') and (
                previous.get('boot_id') != state['boot_id'] or
                state.get('active_command_id') not in {previous['active_command_id'], None})
            reference_procedure = context and context.get('classification') == 'REQUIRES_HOME' and context.get('error_code') == 'REFERENCE_LOST'
            mismatch = mismatch or previous and (previous.get('fault_context') or {}).get('error_code') == 'STATE_MISMATCH' and not reference_procedure
            if mismatch and not (restarted and clean_home):
                state['fault_context'] = previous.get('fault_context') or {'command_id': previous['active_command_id']}
                state['system_state'] = 'ERROR'
                state['allowed_actions'] = []
                state['fault_context'].update(error_code='STATE_MISMATCH', classification='REQUIRES_HOME', position_trusted=False)
            db.execute('INSERT OR REPLACE INTO simulation_state VALUES(?,?,?)', (group, canonical(state), time.time()))
            for entry in state.get('history', []):
                key = canonical([state['boot_id'], group, entry.get('timestamp'), entry.get('event')])
                if db.execute('INSERT OR IGNORE INTO simulation_event_receipts VALUES(?)', (key,)).rowcount:
                    self._history(db, group, entry['event'], entry)
            if not previous or previous.get('system_state') != state.get('system_state') or previous.get('event') != state.get('event'):
                self._history(db, group, state.get('event', 'state_reconciliation'), state)
            if context and state.get('system_state') in LOCKED:
                db.execute("UPDATE local_transactions SET operation_status='UNCERTAIN' WHERE operation_status IN ('EXECUTING','AWAITING_CONFIRMATION') AND (address-1)/6=?", (group-1,))
        self.live.add(group)
        if not hasattr(self.serial, 'links'):
            self.single_group = group
        if state.get('active_command_id') and state['system_state'] not in LOCKED and time.time() - state.get('operation_started_at', time.time()) > 90:
            self.send(group, 'STOP', address=state['current_command']['rack_id'], error_code='SENSOR_TIMEOUT')
        if context and context.get('classification') == 'RECOVERABLE' and state['system_state'] == 'RECOVERING' and 'RESUME' in state['allowed_actions']:
            self.recover(group, 'RESUME', context['fault_id'], confirmed=True)
        return True

    def guard(self, address):
        group = (int(address)-1)//6+1
        state = next((s for s in self.states() if s['cabinet_index'] == group), None)
        if not state or not state['online']:
            raise ValueError('Reconcile a fresh Simulation snapshot before sending commands')
        if state['system_state'] in LOCKED or state.get('active_command_id') or state.get('pending_commands'):
            raise ValueError('Cabinet has a fault or an unfinished command; recover it first')
        if any(state.get('sensors', {}).get('faults', {}).values()):
            raise ValueError('Cabinet physical interlock is active')
        if state.get('sensors', {}).get('position_trusted') is not True:
            raise ValueError('Verify the mechanical reference before issuing commands')
        return state

    def recover(self, group, action, fault_id, confirmed=False):
        state = next((s for s in self.states() if s['cabinet_index'] == group), None)
        if not state or not state['online'] or action not in state['allowed_actions']:
            raise ValueError('Recovery action is not safe in the current reconciled state')
        context = state.get('fault_context') or {}
        if context.get('fault_id') != fault_id:
            raise ValueError('Fault context changed; refresh before recovery')
        if action in {'RESUME', 'HOME'} and not confirmed:
            raise ValueError('Confirm inspected sensors and reference before recovery')
        with self.store.transaction() as db:
            # Resume the existing journal phase, never dispatch OPEN/CLOSE again.
            if action == 'RESUME':
                db.execute("UPDATE local_transactions SET operation_status='EXECUTING',moving=1 WHERE transaction_id=? AND operation_status='UNCERTAIN'",
                           (context.get('command_id'),))
            elif action in {'ABORT', 'HOME'}:
                db.execute("UPDATE local_transactions SET operation_status='CANCELLED',note='Interrupted operation aborted during recovery' WHERE operation_status='UNCERTAIN' AND (address-1)/6=?",
                           (group-1,))
            state['allowed_actions'] = []
            db.execute('UPDATE simulation_state SET body=? WHERE cabinet_index=?', (canonical(state), group))
            self._history(db, group, 'recovery_requested', state)
        try:
            return self.send(group, action, fault_id=fault_id, confirmed=confirmed)
        except Exception:
            self.lost(group)
            raise
