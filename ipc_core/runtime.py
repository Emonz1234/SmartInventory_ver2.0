import json
import logging
import threading
import time
from datetime import datetime, timezone
from ipc_core.protocol import decode, encode, validate, topic, envelope, canonical
from ipc_core.store import Store, RevisionGap
from ipc_core.projection import project

log = logging.getLogger(__name__)


class Runtime:
    def __init__(self, settings, serial):
        self.settings, self.serial = settings, serial
        self.store = Store(settings.DB_PATH, settings.DEVICE_ID, settings.DEVICE_TYPE)
        self.lease_until = 0
        self.connected = False
        self.remote_revision = None
        self.stop_event = threading.Event()
        self.client = None
        self.thread = None

    @property
    def online(self):
        return self.connected and time.time() < self.lease_until

    @property
    def synced(self):
        return self.online and self.remote_revision is not None and self.remote_revision > 0 and self.store.revision() == self.remote_revision

    def request_sync(self):
        self.store.emit("sync", "sync.request", {}, dataset_id=self.settings.DEVICE_ID, revision=self.store.revision())

    def send_checked(self, body):
        # Preserve the existing physical breakdown interlock for open/close.
        if body["action"] in {"OPEN", "CLOSE", "VENTILATE"}:
            from ipc_core.app.utils.timezone import get_current_time
            with self.store.transaction() as db:
                exists = db.execute("SELECT 1 FROM sqlite_master WHERE name='breakdown_snapshots'").fetchone()
                row = db.execute("SELECT * FROM breakdown_snapshots WHERE rack_id=? ORDER BY id DESC LIMIT 1", (body["rack_id"],)).fetchone() if exists else None
                if row and any(row[k] for k in ("is_obstructed", "is_skewed", "is_overload_motor")):
                    raise ValueError("Active hardware breakdown; wait for an explicit clear snapshot")
        self.serial.send_domain(body)

    def receive(self, route, raw):
        cfg = self.settings
        message = decode(raw, cfg.DEVICE_SECRET)
        validate(route, message, cfg.DEVICE_ID, cfg.DEVICE_TYPE, "down")
        kind = message["message_type"]
        if kind == "ack.received":
            self.store.delivered(message["correlation_id"])
        elif kind == "ack.rejected":
            with self.store.transaction() as db:
                db.execute("INSERT INTO edge_runtime(body) VALUES(?)", (json.dumps(message),))
                db.execute("DELETE FROM edge_outbox WHERE id=?", (message["correlation_id"],))
        elif kind == "status.lease":
            until = datetime.fromisoformat(message["payload"]["expires_at"]).timestamp()
            self.lease_until = min(until, time.time()+35)
            self.remote_revision = message["payload"]["revision"]
        elif kind.startswith("sync."):
            try:
                self.store.apply(message, project)
                self.remote_revision = max(self.remote_revision or 0, message["revision"])
            except (RevisionGap, ValueError, KeyError) as exc:
                self.store.emit("sync", "sync.error", {"reason": str(exc)}, dataset_id=cfg.DEVICE_ID, revision=self.store.revision())
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
            self.store.emit("events", "events.command_result", {"state": state}, command_id=message["command_id"])
        else:
            raise ValueError("Unsupported downlink")

    def record_serial(self, message):
        if message.msg_type not in {"telemetry", "event", "ack"}:
            return
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

    def start(self):
        if not self.settings.MQTT_HOST:
            return
        import paho.mqtt.client as mqtt
        cfg = self.settings
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=cfg.DEVICE_ID, clean_session=False, manual_ack=True)
        self.client.username_pw_set(cfg.DEVICE_ID, cfg.MQTT_PASSWORD)
        if cfg.MQTT_TLS:
            self.client.tls_set(ca_certs=cfg.MQTT_CA or None)
        self.client.reconnect_delay_set(1, 30)
        def connected(c, userdata, flags, reason, properties):
            self.connected = not reason.is_failure
            self.lease_until = 0
            if self.connected:
                c.subscribe(f"inventory/v1/{cfg.DEVICE_ID}/down/+", qos=1)
                self.request_sync()
        def disconnected(*args):
            self.connected, self.lease_until = False, 0
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
        self.client.connect_async(cfg.MQTT_HOST, cfg.MQTT_PORT, keepalive=20)
        self.client.loop_start()
        self.thread = threading.Thread(target=self.pump, daemon=True)
        self.thread.start()

    def pump(self):
        heartbeat = 0
        while not self.stop_event.wait(2):
            try:
                if not self.connected:
                    continue
                if time.monotonic()-heartbeat > 10:
                    self.store.emit("status", "status.heartbeat", {"serial_connected": self.serial.connected})
                    heartbeat = time.monotonic()
                for row in self.store.pending():
                    msg = json.loads(row["body"])
                    info = self.client.publish(topic(self.settings.DEVICE_ID, "up", row["channel"]), encode(msg, self.settings.DEVICE_SECRET), qos=1)
                    info.wait_for_publish(timeout=2)
                    if row["channel"] == "ack" and info.is_published():
                        self.store.delivered(row["id"])
            except Exception:
                log.exception("Outbox send failed; retrying")

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)
        if self.client:
            self.client.disconnect()
            self.client.loop_stop()
