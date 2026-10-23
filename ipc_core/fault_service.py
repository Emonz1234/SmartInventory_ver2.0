"""Persistent fault occurrences and maintenance attention; never controls hardware."""
import json
import time
from collections import Counter

PHYSICAL_CODES = {1: 'OBSTRUCTED', 2: 'SKEWED', 3: 'MOTOR_OVERLOAD'}
DESCRIPTIONS = {
    'OBSTRUCTED': 'Obstacle detected', 'SKEWED': 'Rack alignment fault',
    'MOTOR_OVERLOAD': 'Motor overload', 'SENSOR_TIMEOUT': 'Position sensor timeout',
    'REFERENCE_LOST': 'Mechanical reference lost', 'STATE_MISMATCH': 'Mechanical state requires inspection',
}
EXCLUDED_CODES = {'COMMUNICATION_LOST', 'OPERATOR_STOP'}
SAFETY_CODES = set(PHYSICAL_CODES.values()) | {'REFERENCE_LOST', 'STATE_MISMATCH'}


class FaultService:
    def __init__(self, store, settings, recovery):
        self.store, self.recovery = store, recovery
        self.threshold = getattr(settings, 'REPEATED_FAULT_THRESHOLD', 3)
        self.window = getattr(settings, 'REPEATED_FAULT_WINDOW_MINUTES', 30)
        with store.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS fault_occurrences(
                    id INTEGER PRIMARY KEY, address INTEGER NOT NULL, cabinet_index INTEGER NOT NULL,
                    error_code TEXT NOT NULL, codes TEXT NOT NULL, severity TEXT NOT NULL,
                    detected_at REAL NOT NULL, resolved_at REAL, context TEXT NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS fault_one_active_rack
                    ON fault_occurrences(address) WHERE resolved_at IS NULL;
                CREATE INDEX IF NOT EXISTS fault_time ON fault_occurrences(detected_at);
                CREATE TABLE IF NOT EXISTS maintenance_acknowledgements(
                    id INTEGER PRIMARY KEY, address INTEGER NOT NULL, occurrence_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL, username TEXT NOT NULL, acknowledged_at REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS fault_projection(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
            ''')
            self._history(db)
            if recovery:
                # A sensor change may share the previous event/state name and
                # therefore exist only in the retained latest snapshot.
                for row in db.execute('SELECT body,received_at FROM simulation_state').fetchall():
                    self._observe(db,json.loads(row['body']),row['received_at'])

    def _history(self, db):
        if not self.recovery:
            return
        cursor = db.execute("SELECT value FROM fault_projection WHERE key='history'").fetchone()
        rows = db.execute('SELECT * FROM simulation_history WHERE id>? ORDER BY id', (cursor[0] if cursor else 0,)).fetchall()
        for row in rows:
            if row['event'] not in {'communication_lost', 'simulation_restarted', 'recovery_requested'}:
                state = json.loads(row['body'])
                # Extended event receipts are also in this history. Only full
                # reconciled snapshots can prove which sensors cleared.
                if 'racks' in state and 'system_state' in state and 'cabinet_index' in state:
                    self._observe(db, state, row['timestamp'])
        if rows:
            db.execute("INSERT OR REPLACE INTO fault_projection VALUES('history',?)", (rows[-1]['id'],))

    @staticmethod
    def _severity(code, context):
        severity = context.get('severity')
        if severity in {'INFO', 'WARNING', 'ERROR', 'CRITICAL'}:
            return severity
        # Central policy: physical interlocks and untrusted references block motion.
        return 'CRITICAL' if code in SAFETY_CODES or context.get('classification') in {'REQUIRES_HOME', 'FATAL'} else 'ERROR'

    def observe(self, state, detected_at=None):
        with self.store.transaction() as db:
            self._history(db)
            self._observe(db, state, time.time() if detected_at is None else detected_at)

    def _observe(self, db, state, timestamp):
        if state.get('system_state') == 'COMMUNICATION_LOST' or state.get('online') is False:
            return
        group = state['cabinet_index']
        context = state.get('fault_context') or {}
        signals = state.get('sensors', {}).get('faults', {})
        faults = {int(address): [PHYSICAL_CODES.get(code, str(code)) for code in codes]
                  for address, codes in signals.items() if codes}
        code = context.get('error_code')
        address = context.get('rack_id')
        if address and code and code not in EXCLUDED_CODES and not context.get('cleared') and not context.get('resumed'):
            if code not in PHYSICAL_CODES.values() or not signals:
                faults.setdefault(int(address), []).append(code)
        active = {row['address']: row for row in db.execute('SELECT * FROM fault_occurrences WHERE cabinet_index=? AND resolved_at IS NULL', (group,))}
        for address, row in active.items():
            if address not in faults:
                db.execute('UPDATE fault_occurrences SET resolved_at=? WHERE id=?', (max(timestamp, row['detected_at']), row['id']))
        for address, codes in faults.items():
            if (address-1)//6+1 != group:
                continue
            codes = sorted(set(codes))
            detail = dict(context) if context.get('rack_id') == address else {}
            detail.setdefault('command_id',state.get('active_command_id'))
            detail.update(boot_id=state.get('boot_id'), sequence=state.get('sequence'),
                          current_step=state.get('current_step') or state.get('moving') or
                          ({'rack_id':context['moving_rack_id'],'position_mm':context.get('current_position'),
                            'target_position_mm':context.get('target_position'),'progress':context.get('progress')}
                           if context.get('moving_rack_id') else None), current_command=state.get('current_command'),
                          position=state.get('racks', {}).get(str(address), state.get('racks', {}).get(address)))
            severity = max((self._severity(code, detail) for code in codes), key=['INFO','WARNING','ERROR','CRITICAL'].index)
            if address in active:
                codes = sorted(set(codes) | set(json.loads(active[address]['codes'])))
                severity = max([severity,active[address]['severity']], key=['INFO','WARNING','ERROR','CRITICAL'].index)
                # Keep the first detection checkpoint/transaction, not later polls.
                detail = json.loads(active[address]['context'])
                db.execute('UPDATE fault_occurrences SET codes=?,severity=?,context=? WHERE id=?',
                           (json.dumps(codes), severity, json.dumps(detail), active[address]['id']))
            else:
                db.execute('INSERT INTO fault_occurrences(address,cabinet_index,error_code,codes,severity,detected_at,context) VALUES(?,?,?,?,?,?,?)',
                           (address, group, codes[0], json.dumps(codes), severity, timestamp, json.dumps(detail)))

    def overview(self, *, cabinet=None, rack=None, severity=None, status=None, hours=24, search='', offset=0, limit=50, clock=None, fault_id=None):
        now = time.time() if clock is None else clock
        states = self.recovery.states() if self.recovery else []
        online = {state['cabinet_index']: state['online'] for state in states}
        with self.store.transaction() as db:
            self._history(db)
            records = [json.loads(row[0]) for row in db.execute('SELECT body FROM edge_records WHERE dataset=?', (self.store.device_id,))]
            cabinets = {r['data']['id']: r['data'] for r in records if r['kind']=='cabinet'}
            racks = {int(r['data']['rack_code']): r['data'] for r in records if r['kind']=='rack' and str(r['data'].get('rack_code','')).isdigit()}
            raw = [dict(row) for row in db.execute('SELECT * FROM fault_occurrences WHERE detected_at>=? OR resolved_at IS NULL OR id=? ORDER BY detected_at DESC,id DESC', (now-max(hours*3600,self.window*60,86400),fault_id))]
            counts = Counter(row['address'] for row in raw if row['detected_at']>=now-self.window*60)
            warnings = []
            for address, count in counts.items():
                if count < self.threshold:
                    continue
                recent = [r for r in raw if r['address']==address and r['detected_at']>=now-self.window*60]
                common = Counter(code for row in recent for code in json.loads(row['codes'])).most_common(1)[0]
                ack = db.execute('SELECT * FROM maintenance_acknowledgements WHERE address=? AND occurrence_id=? ORDER BY id DESC LIMIT 1', (address,recent[0]['id'])).fetchone()
                warnings.append(dict(address=address, count=count, window_minutes=self.window, latest_occurrence_id=recent[0]['id'],
                                     last_fault=recent[0]['error_code'], last_detected_at=recent[0]['detected_at'],
                                     common_code=common[0], same_fault_repeated=common[1]>=self.threshold,
                                     maintenance_status='ACKNOWLEDGED' if ack else 'INSPECTION RECOMMENDED',
                                     acknowledgement=dict(ack) if ack else None))
            warning_by_address = {w['address']: w for w in warnings}
            def location(address):
                rack = racks.get(address, {})
                cabinet = cabinets.get(rack.get('cabinet_id'), {})
                return dict(rack_id=rack.get('id'), cabinet_id=cabinet.get('id'), cabinet_index=cabinet.get('cabinet_index',(address-1)//6+1), rack_index=rack.get('rack_index',(address-1)%6+1))
            active_addresses = {r['address'] for r in raw if r['resolved_at'] is None}
            for warning in warnings:
                warning.update(location(warning['address']), active_fault=warning['address'] in active_addresses)
            for row in raw:
                row.update(location(row['address']))
                row['codes'] = json.loads(row['codes']); row['context'] = json.loads(row['context'])
                command = row['context'].get('command_id')
                transaction = db.execute('SELECT transaction_id FROM local_transactions WHERE motion_command_id=? OR transaction_id=? LIMIT 1', (command,command)).fetchone() if command else None
                row.update(description=DESCRIPTIONS.get(row['error_code'],row['error_code']),
                           status='ACTIVE' if row['resolved_at'] is None else 'RESOLVED',
                           duration_seconds=max(0,(row['resolved_at'] or now)-row['detected_at']),
                           transaction_id=transaction[0] if transaction else None,
                           recent_fault_count=counts[row['address']], online=online.get(row['cabinet_index'],False))
            active = [r for r in raw if r['status']=='ACTIVE']
            active.sort(key=lambda row: (-['INFO','WARNING','ERROR','CRITICAL'].index(row['severity']),row['detected_at']))
            history = [r for r in raw if (fault_id is None and r['detected_at']>=now-hours*3600 or r['id']==fault_id) and
                       (cabinet is None or r['cabinet_index']==cabinet) and
                       (rack is None or r['address']==rack) and (not severity or r['severity']==severity) and
                       (not status or r['status']==status) and (not search or search.upper() in ' '.join(r['codes']).upper())]
            rack_states = [dict(address=address, **location(address), online=online.get((address-1)//6+1,False),
                                safety_status='ACTIVE FAULT' if address in active_addresses else 'UNKNOWN' if not online.get((address-1)//6+1,False) else 'MAINTENANCE WARNING' if address in warning_by_address else 'NORMAL') for address in sorted(racks)]
            day = [r for r in raw if r['detected_at']>=now-86400]
            top = Counter(r['address'] for r in day).most_common(1)
            unknown = not rack_states or any(not r['online'] for r in rack_states)
            recovery_pending = [dict(cabinet_index=s['cabinet_index'],cabinet_id=location((s['cabinet_index']-1)*6+1)['cabinet_id'])
                                for s in states if s.get('online') and s.get('system_state') in {'RECOVERING','STOPPED'} and (s.get('fault_context') or {}).get('cleared')]
            return dict(summary=dict(safety_status='ACTIVE FAULTS DETECTED' if active else 'UNKNOWN' if unknown else 'MAINTENANCE CHECK RECOMMENDED' if warnings else 'RECOVERY CONFIRMATION REQUIRED' if recovery_pending else 'SYSTEM NORMAL',
                                     active_faults=len(active), warning_racks=len(warnings), faults_24h=len(day),
                                     most_affected_rack=dict(address=top[0][0],count=top[0][1],**location(top[0][0])) if top else None),
                        active_faults=active, maintenance_warnings=warnings, recovery_pending=recovery_pending, racks=rack_states,
                        history=history[offset:offset+limit], history_total=len(history),
                        config=dict(threshold=self.threshold,window_minutes=self.window))

    def acknowledge(self, address, occurrence_id, user_id, username):
        overview = self.overview()
        warning = next((w for w in overview['maintenance_warnings'] if w['address']==address),None)
        if not warning or warning['latest_occurrence_id'] != occurrence_id:
            raise ValueError('Maintenance warning changed; refresh before acknowledging')
        with self.store.transaction() as db:
            latest = db.execute('SELECT max(id) FROM fault_occurrences WHERE address=?', (address,)).fetchone()[0]
            if latest != occurrence_id:
                raise ValueError('Maintenance warning changed; refresh before acknowledging')
            previous = db.execute('SELECT id FROM maintenance_acknowledgements WHERE address=? AND occurrence_id=? AND user_id=?', (address,occurrence_id,user_id)).fetchone()
            if not previous:
                db.execute('INSERT INTO maintenance_acknowledgements(address,occurrence_id,user_id,username,acknowledged_at) VALUES(?,?,?,?,?)', (address,occurrence_id,user_id,username,time.time()))
        return {'acknowledged': True}
