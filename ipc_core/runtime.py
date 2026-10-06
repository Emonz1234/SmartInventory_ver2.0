import json
import logging
import threading
import time
from datetime import datetime, timezone
from ipc_core.protocol import decode, encode, validate, topic, envelope, canonical
from ipc_core.store import Store, RevisionGap
from ipc_core.projection import project

log = logging.getLogger(__name__)
if not log.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s %(message)s'))
    log.addHandler(handler)
log.setLevel(logging.INFO)
log.propagate = False


class Runtime:
    def __init__(self, settings, serial):
        self.settings, self.serial = settings, serial
        self.operation_lock = threading.RLock()
        self.store = Store(settings.DB_PATH, settings.DEVICE_ID, settings.DEVICE_TYPE)
        from ipc_core.recovery_service import RecoveryService
        self.recovery = RecoveryService(self.store, serial) if settings.DEVICE_TYPE == 'IPCSIM' else None
        from ipc_core.fault_service import FaultService
        self.faults = FaultService(self.store, settings, self.recovery)
        from ipc_core.auth_service import AuthService
        from ipc_core.transaction_service import TransactionService
        from ipc_core.sync_service import SyncService
        self.auth = AuthService(self.store)
        self.transactions = TransactionService(self.store, self.auth, self.send_checked)
        self.transactions.recovery = self.recovery
        self.transactions.recover()
        self.sync = SyncService(self.store)
        self.lease_until = 0
        self.connected = False
        self.hardware_fault = False
        self.hardware_fault_details = {}
        self.remote_revision = None
        self._reported_server_online = None
        self._reported_synced = None
        self.stop_event = threading.Event()
        self.client = None
        self.thread = None
        self.restore_operation_history()

    @property
    def online(self):
        return self.connected and time.time() < self.lease_until

    @property
    def synced(self):
        return self.online and self.remote_revision is not None and self.remote_revision > 0 and self.store.revision() == self.remote_revision and not self.sync.repo.state()['pending_transactions']

    def request_sync(self):
        self.sync.full_required = True
        self.sync.requested_at = 0

    def report_server_state(self):
        online, synced = self.online, self.synced
        if online != self._reported_server_online:
            state = "online" if online else "offline (no valid Server lease)"
            print(f"[Server] MQTT status: {state}")
            self._reported_server_online = online
        if synced != self._reported_synced:
            if synced:
                print(f"[Server] Database synchronized at revision {self.store.revision()}")
            else:
                print("[Server] Database not synchronized")
            self._reported_synced = synced

    def send_checked(self, body):
        if self.recovery:
            self.recovery.guard(body['address'])
        with self.store.transaction() as db:
            active = self.transactions.repo.active(db)
            if active and active['transaction_id'] != body.get('transaction_id'):
                raise ValueError('A local physical transaction owns the hardware')
        # Preserve the existing physical breakdown interlock for open/close.
        if body["action"] in {"OPEN", "CLOSE", "VENTILATE"}:
            with self.store.transaction() as db:
                exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='breakdown_snapshots'").fetchone()
                row = db.execute("SELECT * FROM breakdown_snapshots WHERE rack_id=? ORDER BY id DESC LIMIT 1", (body["rack_id"],)).fetchone() if exists else None
                if row and any(row[k] for k in ("is_obstructed", "is_skewed", "is_overload_motor")):
                    raise ValueError("Active hardware breakdown; wait for an explicit clear snapshot")
        if self.recovery:
            self.recovery.send((int(body['address'])-1)//6+1, 'EXECUTE',
                               address=body['address'], action=body['action'],
                               command_id=body.get('command_id') or body.get('transaction_id') or str(__import__('uuid').uuid4()))
        else:
            self.serial.send_domain(body)

    def receive(self, route, raw):
        cfg = self.settings
        message = decode(raw)
        validate(route, message, cfg.DEVICE_ID, cfg.DEVICE_TYPE, "down")
        kind = message["message_type"]
        if kind == 'ack.transaction':
            self.sync.acknowledge(message)
        elif kind == 'status.ready':
            self.sync.handshake(message['payload'])
        elif kind == 'status.reconciled':
            if self.sync.ready and message['payload'].get('revision') == self.store.revision():
                with self.store.transaction() as db:
                    allowed = self.sync.repo.can_pull(db)
                if allowed:
                    self.sync.reconciled()
        elif kind == "ack.received":
            self.store.delivered(message["correlation_id"])
        elif kind == "ack.rejected":
            self.sync.failed(message.get('correlation_id'), message['payload'].get('reason', 'Rejected'))
            with self.store.transaction() as db:
                db.execute("INSERT INTO edge_runtime(body) VALUES(?)", (json.dumps(message),))
                db.execute("DELETE FROM edge_outbox WHERE id=?", (message["correlation_id"],))
        elif kind == "status.lease":
            until = datetime.fromisoformat(message["payload"]["expires_at"]).timestamp()
            self.lease_until = min(until, time.time()+35)
            self.remote_revision = message["payload"]["revision"]
        elif kind.startswith("sync."):
            if not self.sync.accept_master(message):
                return
            try:
                result = self.store.apply(message, project, allow_revision_reset=True)
                if result in ('applied', 'duplicate'):
                    self.sync.reconciled()
                if result != 'deferred':
                    self.remote_revision = max(self.remote_revision or 0, message["revision"])
            except (RevisionGap, ValueError, KeyError) as exc:
                self.request_sync()
                raise
        elif kind == "command.finalize":
            state = message["payload"]["state"]
            if state not in {"confirmed", "failed"}:
                raise ValueError("Invalid final operation state")
            with self.store.transaction() as db:
                body = canonical(message["payload"]["command"])
                previous = db.execute("SELECT body FROM edge_operations WHERE id=?", (message["command_id"],)).fetchone()
                if previous and previous[0] != body:
                    raise ValueError("Finalization command mismatch")
                db.execute("INSERT INTO edge_operations(id,body,state) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
                           (message["command_id"], body, state))
                ack = envelope(cfg.DEVICE_ID, cfg.DEVICE_TYPE, "ack.command", {}, correlation_id=message["message_id"])
                self.store.enqueue(db, "ack", ack)
        elif kind == "command.execute":
            log.info('command.receive device=%s command=%s rack=%s address=%s action=%s', cfg.DEVICE_ID,
                     message['command_id'], message['payload'].get('rack_id'), message['payload'].get('address'), message['payload'].get('action'))
            with self.store.transaction() as db:
                if self.transactions.repo.active(db):
                    raise ValueError('Local physical transaction is active')
            body = message["payload"]
            with self.store.transaction() as db:
                old = db.execute("SELECT * FROM edge_operations WHERE id=?", (message["command_id"],)).fetchone()
            if old:
                if old["body"] != canonical(body):
                    raise ValueError("Command ID collision")
                state = old["state"]
            elif datetime.fromisoformat(body["expires_at"]) < datetime.now(timezone.utc):
                state = "expired"
                with self.store.transaction() as db:
                    db.execute("INSERT OR IGNORE INTO edge_operations(id,body,state) VALUES(?,?,?)",
                               (message["command_id"], canonical(body), state))
            else:
                try:
                    state = self.store.execute(message, self.send_checked, self.online)
                except RevisionGap:
                    self.request_sync()
                    return
                except Exception:
                    with self.store.transaction() as db:
                        row = db.execute("SELECT state FROM edge_operations WHERE id=?", (message["command_id"],)).fetchone()
                    if not row:
                        raise
                    state = row[0]
            with self.store.transaction() as db:
                saved = db.execute('SELECT result FROM edge_operations WHERE id=?', (message['command_id'],)).fetchone()
            result = json.loads(saved[0]) if saved and saved[0] else {"state": state}
            log.info('command.result device=%s command=%s state=%s', cfg.DEVICE_ID, message['command_id'], state)
            self.store.emit("events", "events.command_result", result, command_id=message["command_id"])
        else:
            raise ValueError("Unsupported downlink")

    def record_serial(self, message):
        if message.msg_type == 'simulation_state':
            if self.recovery:
                try:
                    accepted = self.recovery.receive(message.payload)
                except (ValueError, KeyError, TypeError):
                    self.recovery.lost(message.payload.get('cabinet_index'))
                    raise
                if accepted:
                    state = next((s for s in self.recovery.states() if s['cabinet_index'] == message.payload['cabinet_index']), None)
                    if state:
                        self.faults.observe(state)
                    if state:
                        self.report_simulation_command(state)
                    if state:
                        with self.operation_lock:
                            self.transactions.reconcile(state)
            return
        if message.msg_type not in {"telemetry", "event", "ack"}:
            return
        # Extended Simulation faults suspend the journal until reconciliation.
        # Legacy fault frames remain visible but do not destroy resumable context.
        locked = self.recovery and any(s['cabinet_index'] == (int(message.payload.get('rack_id', 1))-1)//6+1 and
                                      s['system_state'] in {'ERROR', 'RECOVERING', 'STOPPED', 'COMMUNICATION_LOST'} for s in self.recovery.states())
        if not self.recovery and not locked:
            self.transactions.observe(message.payload)
        fault_keys = ('is_obstructed', 'is_skewed', 'is_overload_motor')
        if any(key in message.payload for key in fault_keys):
            self.hardware_fault = any(message.payload.get(key) for key in fault_keys)
            self.hardware_fault_details = dict(message.payload) if self.hardware_fault else {}
        kind = "telemetry.sample" if message.msg_type == "telemetry" else "events.serial"
        channel = kind.split(".")[0]
        outgoing = envelope(self.settings.DEVICE_ID, self.settings.DEVICE_TYPE, kind, message.payload)
        with self.store.transaction() as db:
            db.execute("INSERT INTO edge_runtime(body) VALUES(?)", (json.dumps(outgoing),))
            address = message.payload.get("rack_id")
            assigned = any(r.get("kind") == "rack" and str(r["data"]["rack_code"]) == str(address)
                           for r in (json.loads(row[0]) for row in db.execute("SELECT body FROM edge_records")))
            if assigned:
                self.store.enqueue(db, channel, outgoing)

    def report_simulation_command(self, snapshot, observed_at=None, publish=True):
        """Persist actual local/Server execution independently of delivery state."""
        from ipc_core.operation_history import execution_result
        command_id = snapshot.get('active_command_id') or snapshot.get('last_command_id')
        if not command_id:
            return
        timestamp = datetime.fromtimestamp(observed_at, timezone.utc).isoformat() if observed_at is not None else datetime.now(timezone.utc).isoformat()
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM edge_operations WHERE id=?', (command_id,)).fetchone()
            if not row or row['state'] in {'rejected','expired','failed'}:
                return
            body = json.loads(row['body'])
            result = execution_result(snapshot, command_id, body['address'], body.get('action') or body.get('kind'))
            if not result:
                return
            db.execute('INSERT OR IGNORE INTO edge_operation_times(id,created_at,updated_at) VALUES(?,?,?)', (command_id,timestamp,timestamp))
            previous = json.loads(row['result'] or '{}')
            if result['execution_state'] == 'completed':
                db.execute('UPDATE edge_operation_times SET completed_at=COALESCE(completed_at,?) WHERE id=?', (timestamp,command_id))
            if previous.get('execution_state') == 'completed' or row['result'] == canonical(result):
                return
            db.execute('UPDATE edge_operations SET result=? WHERE id=?', (canonical(result), command_id))
            db.execute('UPDATE edge_operation_times SET updated_at=? WHERE id=?', (timestamp,command_id))
            if publish and row['state'] == 'sent':
                # MQTT retains its existing moving/completed/fault vocabulary.
                wire_result = {**result,'execution_state':'fault'} if result['execution_state']=='paused' else result
                outgoing = envelope(self.settings.DEVICE_ID, self.settings.DEVICE_TYPE, 'events.command_result', wire_result, command_id=command_id)
                self.store.enqueue(db, 'events', outgoing)
        log.info('command.execution device=%s command=%s execution=%s address=%s', self.settings.DEVICE_ID, command_id, result['execution_state'],body['address'])

    def restore_operation_history(self):
        if not self.recovery:
            return
        with self.store.transaction() as db:
            history = [(row['timestamp'],json.loads(row['body'])) for row in db.execute('SELECT timestamp,body FROM simulation_history ORDER BY id')]
            history += [(row['received_at'],json.loads(row['body'])) for row in db.execute('SELECT received_at,body FROM simulation_state')]
        for timestamp,snapshot in history:
            if 'cabinet_index' in snapshot and 'racks' in snapshot and snapshot.get('system_state') != 'COMMUNICATION_LOST':
                self.report_simulation_command(snapshot,observed_at=timestamp,publish=False)

    def start(self):
        if not self.settings.MQTT_HOST:
            print("[MQTT] Disabled: MQTT_HOST is empty")
            return
        from ipc_core.mqtt_client import create_client
        cfg = self.settings
        self.client = create_client(cfg)
        def connected(c, userdata, flags, reason, properties):
            self.connected = not reason.is_failure
            self.lease_until = 0
            if self.connected:
                print(f"[MQTT] Broker connected: {cfg.MQTT_HOST}:{cfg.MQTT_PORT} (TLS {'on' if cfg.MQTT_TLS else 'off'})")
                c.subscribe(f"inventory/v1/{cfg.DEVICE_ID}/down/+", qos=1)
                self.sync.connected()
            else:
                print(f"[MQTT] Broker connection failed: {reason}")
            self.report_server_state()
        def disconnected(*args):
            self.connected, self.lease_until = False, 0
            self.sync.disconnected()
            reason = args[3] if len(args) > 3 else "connection closed"
            print(f"[MQTT] Broker disconnected: {reason}")
            self.report_server_state()
        def incoming(c, userdata, msg):
            if msg.retain and msg.topic.endswith('/command'):
                log.error("Rejected retained command")
                c.ack(msg.mid, msg.qos)
                return
            try:
                self.receive(msg.topic, msg.payload)
            except (ValueError, KeyError, TypeError):
                log.exception("Rejected downlink")
            except Exception:
                log.exception("Transient processing failure")
                return
            c.ack(msg.mid, msg.qos)
        self.client.on_connect, self.client.on_disconnect, self.client.on_message = connected, disconnected, incoming
        print(f"[MQTT] Connecting to broker {cfg.MQTT_HOST}:{cfg.MQTT_PORT} (TLS {'on' if cfg.MQTT_TLS else 'off'})")
        self.client.connect_async(cfg.MQTT_HOST, cfg.MQTT_PORT, keepalive=20)
        self.client.loop_start()
        self.thread = threading.Thread(target=self.pump, daemon=True)
        self.thread.start()

    def pump(self):
        heartbeat = 0
        while not self.stop_event.wait(2):
            try:
                self.report_server_state()
                if not self.connected:
                    continue
                outgoing = self.sync.next_message()
                if outgoing:
                    try:
                        info = self.client.publish(topic(self.settings.DEVICE_ID, 'up', outgoing['message_type'].split('.')[0]), encode(outgoing), qos=1)
                        info.wait_for_publish(timeout=2)
                        if not info.is_published():
                            self.sync.failed(outgoing['message_id'], 'MQTT publish not acknowledged')
                    except Exception as exc:
                        self.sync.failed(outgoing['message_id'], exc)
                        raise
                if time.monotonic()-heartbeat > 10:
                    self.store.emit("status", "status.heartbeat", {"serial_connected": self.serial.connected})
                    heartbeat = time.monotonic()
                batch_started = time.monotonic()
                for row in self.store.pending():
                    # SyncService owns reconnect ordering; discard obsolete legacy sync requests.
                    if row['channel'] == 'sync':
                        self.store.delivered(row['id'])
                        continue
                    msg = json.loads(row["body"])
                    info = self.client.publish(topic(self.settings.DEVICE_ID, "up", row["channel"]), encode(msg), qos=1)
                    info.wait_for_publish(timeout=2)
                    if row["channel"] == "ack" and info.is_published():
                        self.store.delivered(row["id"])
                    elif info.is_published():
                        self.store.sent(row["id"])
                    else:
                        break
                    if time.monotonic()-batch_started >= 2:
                        break
            except Exception:
                log.exception("Outbox send failed; retrying")

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)
        if self.client:
            self.client.disconnect()
            self.client.loop_stop()
