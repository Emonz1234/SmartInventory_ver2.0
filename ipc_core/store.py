"""SQLite journal and atomic read-model sync shared by both edge types."""
import json
import sqlite3
import time
from contextlib import contextmanager, closing
from pathlib import Path
from ipc_core.protocol import canonical, checksum, envelope


class RevisionGap(ValueError):
    pass


class Store:
    def __init__(self, path, device_id, device_type):
        self.path, self.device_id, self.device_type = str(path), device_id, device_type
        Path(path).resolve().parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db, db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS edge_migrations(version INTEGER PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS edge_identity(id INTEGER PRIMARY KEY CHECK(id=1), device_id TEXT, device_type TEXT);
                CREATE TABLE IF NOT EXISTS edge_revision(dataset TEXT PRIMARY KEY, revision INTEGER NOT NULL, digest TEXT);
                CREATE TABLE IF NOT EXISTS edge_records(dataset TEXT, key TEXT, body TEXT, PRIMARY KEY(dataset,key));
                CREATE TABLE IF NOT EXISTS edge_staging(sync_id TEXT, batch INTEGER, metadata TEXT, body TEXT, PRIMARY KEY(sync_id,batch));
                CREATE TABLE IF NOT EXISTS edge_outbox(id TEXT PRIMARY KEY, channel TEXT, body TEXT, attempts INTEGER DEFAULT 0);
                CREATE TABLE IF NOT EXISTS edge_operations(id TEXT PRIMARY KEY, body TEXT, state TEXT, result TEXT);
                CREATE TABLE IF NOT EXISTS edge_runtime(id INTEGER PRIMARY KEY, body TEXT NOT NULL);
                INSERT OR IGNORE INTO edge_migrations VALUES(1);
            ''')
            identity = db.execute("SELECT device_id,device_type FROM edge_identity WHERE id=1").fetchone()
            if identity and tuple(identity) != (device_id, device_type):
                raise ValueError("Database belongs to another device")
            if not identity:
                has_cabinets = db.execute("SELECT 1 FROM sqlite_master WHERE name='cabinets'").fetchone()
                if has_cabinets and db.execute("SELECT 1 FROM cabinets LIMIT 1").fetchone():
                    raise ValueError("Legacy populated database: back up/import it and choose a NEW edge DB_PATH")
            db.execute("INSERT OR IGNORE INTO edge_identity VALUES(1,?,?)", (device_id, device_type))
            if 'sent_at' not in {r[1] for r in db.execute('PRAGMA table_info(edge_outbox)')}:
                db.execute('ALTER TABLE edge_outbox ADD COLUMN sent_at REAL')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        return db

    @contextmanager
    def transaction(self):
        db = self.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def revision(self, dataset=None, db=None):
        if db is None:
            with self.transaction() as conn:
                return self.revision(dataset, conn)
        row = db.execute("SELECT revision FROM edge_revision WHERE dataset=?", (dataset or self.device_id,)).fetchone()
        return row[0] if row else 0

    def enqueue(self, db, channel, message):
        if message['message_type'] == 'status.heartbeat':
            # Only the latest liveness sample is useful; preserve all business events.
            db.execute("DELETE FROM edge_outbox WHERE channel='status' AND json_extract(body,'$.message_type')='status.heartbeat'")
        db.execute("INSERT OR IGNORE INTO edge_outbox(id,channel,body) VALUES(?,?,?)",
                   (message["message_id"], channel, canonical(message)))

    def emit(self, channel, kind, payload, **metadata):
        message = envelope(self.device_id, self.device_type, kind, payload, **metadata)
        with self.transaction() as db:
            self.enqueue(db, channel, message)
        return message

    def ack(self, db, incoming):
        message = envelope(self.device_id, self.device_type, "ack.applied", {},
                           correlation_id=incoming["message_id"],
                           dataset_id=incoming.get("dataset_id"), revision=incoming.get("revision"))
        self.enqueue(db, "ack", message)

    def pending(self):
        with self.transaction() as db:
            return [dict(row) for row in db.execute('''SELECT * FROM edge_outbox
                WHERE sent_at IS NULL OR sent_at <= ?
                ORDER BY CASE channel WHEN 'status' THEN 0 WHEN 'ack' THEN 1
                    WHEN 'sync' THEN 2 ELSE 3 END, COALESCE(sent_at,0), rowid LIMIT 100''',
                (time.time()-15,))]

    def sent(self, message_id):
        with self.transaction() as db:
            db.execute('UPDATE edge_outbox SET sent_at=?, attempts=attempts+1 WHERE id=?',
                       (time.time(), message_id))

    def delivered(self, message_id):
        with self.transaction() as db:
            db.execute("DELETE FROM edge_outbox WHERE id=?", (message_id,))

    def records(self):
        with self.transaction() as db:
            return [json.loads(r[0]) for r in db.execute("SELECT body FROM edge_records ORDER BY key")]

    def apply(self, message, project=None):
        dataset = message["dataset_id"]
        if dataset != self.device_id:
            raise ValueError("Dataset outside assignment")
        rev, payload = message["revision"], message["payload"]
        if type(rev) is not int or rev < 1:
            raise ValueError("Invalid revision")
        with self.transaction() as db:
            current = self.revision(dataset, db)
            if rev < current:
                return "stale"
            if rev == current:
                cached = [json.loads(r[0]) for r in db.execute("SELECT body FROM edge_records WHERE dataset=? ORDER BY key", (dataset,))]
                if message["message_type"] != "sync.full" or checksum(cached) == payload["digest"]:
                    self.ack(db, message)
                    return "duplicate"
                # A trusted full snapshot can repair damaged read-model rows at
                # the same revision; staging/integrity checks still apply below.
            if message["message_type"] == "sync.full":
                count, index = payload["count"], payload["index"]
                if type(count) is not int or type(index) is not int or not 1 <= count <= 10000 or not 0 <= index < count:
                    raise ValueError("Invalid batch")
                metadata = canonical({"revision": rev, "count": count, "digest": payload["digest"]})
                sid = message["sync_id"]
                previous = db.execute("SELECT metadata,body FROM edge_staging WHERE sync_id=? AND batch=?", (sid, index)).fetchone()
                if previous and tuple(previous) != (metadata, canonical(payload["records"])):
                    raise ValueError("Conflicting batch")
                db.execute("INSERT OR IGNORE INTO edge_staging VALUES(?,?,?,?)", (sid, index, metadata, canonical(payload["records"])))
                batches = db.execute("SELECT * FROM edge_staging WHERE sync_id=? ORDER BY batch", (sid,)).fetchall()
                if any(b["metadata"] != metadata for b in batches):
                    raise ValueError("Conflicting snapshot metadata")
                if len(batches) != count:
                    return "staged"
                records = [r for b in batches for r in json.loads(b["body"])]
                if checksum(records) != payload["digest"]:
                    raise ValueError("Snapshot checksum mismatch")
                db.execute("DELETE FROM edge_records WHERE dataset=?", (dataset,))
            elif message["message_type"] == "sync.delta":
                if payload["base_revision"] != current or rev != current + 1:
                    raise RevisionGap("Full sync required")
                changes = {"records": payload["records"], "deleted": payload["deleted"]}
                if checksum(changes) != payload["digest"]:
                    raise ValueError("Delta checksum mismatch")
                records = payload["records"]
                for key in payload["deleted"]:
                    db.execute("DELETE FROM edge_records WHERE dataset=? AND key=?", (dataset, key))
            else:
                raise ValueError("Unknown sync message")
            keys = set()
            for record in records:
                key = record["key"]
                if key in keys or record.get("domain", self.device_type) != self.device_type:
                    raise ValueError("Duplicate key or cross-domain record")
                keys.add(key)
                db.execute("INSERT OR REPLACE INTO edge_records VALUES(?,?,?)", (dataset, key, canonical(record)))
            if project:
                project(db)
            db.execute("INSERT OR REPLACE INTO edge_revision VALUES(?,?,?)", (dataset, rev, payload["digest"]))
            if message["message_type"] == "sync.full":
                db.execute("DELETE FROM edge_staging WHERE sync_id=?", (message["sync_id"],))
            self.ack(db, message)
            return "applied"

    def execute_local(self, operation_id, rack_id, action, send):
        if action not in {"OPEN", "CLOSE", "VENTILATE", "LIGHT", "HOME", "LIGHT_OFF"}:
            raise ValueError("Unsupported device command")
        if type(rack_id) is not int or rack_id < 1:
            raise ValueError("Invalid rack ID")

        with self.transaction() as db:
            previous = db.execute("SELECT body,state FROM edge_operations WHERE id=?", (operation_id,)).fetchone()
            if previous:
                recorded = json.loads(previous["body"])
                if recorded.get("requested_rack_id", recorded.get("rack_id")) != rack_id or recorded.get("kind") != action:
                    raise ValueError("Request key reused with a different command")
                return previous["state"]

            rack = db.execute("SELECT body FROM edge_records WHERE dataset=? AND key=?",
                              (self.device_id, f"rack:{rack_id}")).fetchone()
            if not rack:
                candidates = []
                for row in db.execute("SELECT body FROM edge_records WHERE dataset=?", (self.device_id,)):
                    record = json.loads(row["body"])
                    if record.get("kind") == "rack" and str(record.get("data", {}).get("rack_code")) == str(rack_id):
                        candidates.append(record)
                if len(candidates) != 1:
                    raise ValueError("Rack ID or Serial address is not present uniquely in the local topology cache")
                rack_data = candidates[0].get("data", {})
            else:
                rack_data = json.loads(rack["body"]).get("data", {})
            try:
                address = int(rack_data["rack_code"])
                resolved_rack_id = int(rack_data["id"])
            except (KeyError, TypeError, ValueError):
                raise ValueError("Rack has no valid local Serial address") from None

            body = {"rack_id": resolved_rack_id, "requested_rack_id": rack_id, "kind": action, "address": address}
            db.execute("INSERT INTO edge_operations(id,body,state,result) VALUES(?,?,?,NULL)",
                       (operation_id, canonical(body), "local_uncertain"))

        command = {"rack_id": resolved_rack_id, "address": address, "action": action}
        try:
            send(command)
        except ValueError:
            with self.transaction() as db:
                db.execute("UPDATE edge_operations SET state='rejected' WHERE id=?", (operation_id,))
            raise

        with self.transaction() as db:
            db.execute("UPDATE edge_operations SET state='local_sent' WHERE id=?", (operation_id,))
        return "local_sent"

    def execute(self, message, send, online):
        command_id, body = message["command_id"], message["payload"]
        with self.transaction() as db:
            previous = db.execute("SELECT * FROM edge_operations WHERE id=?", (command_id,)).fetchone()
            if previous:
                if previous["body"] != canonical(body):
                    raise ValueError("Command ID reused with different payload")
                return previous["state"]
            if not online:
                raise ValueError("Inventory operations require online Server")
            if message.get("revision") != self.revision(db=db):
                raise RevisionGap("Command revision differs from cache")
            rack = db.execute("SELECT body FROM edge_records WHERE key=?", (f"rack:{body['rack_id']}",)).fetchone()
            if not rack:
                raise ValueError("Rack outside assigned dataset")
            address = json.loads(rack[0]).get("data", {}).get("rack_code")
            if address is not None and str(address) != str(body.get("address")):
                raise ValueError("Command Serial address differs from assigned rack")
            db.execute("INSERT INTO edge_operations VALUES(?,?,?,NULL)", (command_id, canonical(body), "uncertain"))
        # Intent is durable BEFORE the side effect. A failed/partial write stays uncertain.
        send(body)
        with self.transaction() as db:
            db.execute("UPDATE edge_operations SET state='sent' WHERE id=?", (command_id,))
        return "sent"
