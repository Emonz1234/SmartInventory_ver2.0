import json
import sqlite3
from datetime import datetime, timedelta, timezone
import pytest
from ipc_core.store import Store, RevisionGap
from ipc_core.protocol import envelope, checksum, encode, decode, validate, topic
from ipc_core.adapters import HardwareAdapter, SimulationAdapter


def snapshot(device="sim-a", rev=1, records=None, **overrides):
    records = records if records is not None else [{"key": "rack:1", "kind": "rack", "domain": "IPCSIM", "data": {"id": 1}}]
    message = envelope(device, "IPCSIM", "sync.full", dict(index=0, count=1, digest=checksum(records), records=records),
                       dataset_id=device, revision=rev, sync_id=f"sync-{rev}")
    message.update(overrides)
    return message


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "edge.sqlite3", "sim-a", "IPCSIM")


def test_database_identity_and_independence(tmp_path):
    a = Store(tmp_path / "a.db", "sim-a", "IPCSIM")
    b = Store(tmp_path / "b.db", "sim-b", "IPCSIM")
    a.apply(snapshot())
    assert b.records() == []
    with pytest.raises(ValueError):
        Store(tmp_path / "a.db", "other", "IPC")


def test_full_sync_duplicate_stale_and_scope(store):
    msg = snapshot()
    assert store.apply(msg) == "applied"
    assert store.apply(msg) == "duplicate"
    store.apply(snapshot(rev=2, records=[]))
    assert store.records() == []
    assert store.apply(msg) == "stale"
    with pytest.raises(ValueError):
        store.apply(snapshot(device="other"))


def test_batches_out_of_order_and_integrity(store):
    msg = snapshot()
    msg["payload"]["count"] = 2
    msg["payload"]["index"] = 1
    assert store.apply(msg) == "staged"
    assert store.records() == []
    msg["payload"]["index"] = 0
    msg["payload"]["records"] = []
    assert store.apply(msg) == "applied"
    assert len(store.records()) == 1
    broken = snapshot(rev=2)
    broken["payload"]["digest"] = "bad"
    with pytest.raises(ValueError):
        store.apply(broken)
    assert store.revision() == 1


def test_atomic_rollback_preserves_runtime_and_pending(store):
    store.apply(snapshot())
    with store.transaction() as db:
        db.execute("INSERT INTO edge_runtime(body) VALUES('{}')")
        db.execute("INSERT INTO edge_operations VALUES('op','{}','uncertain',NULL)")
    def crash(db):
        raise RuntimeError("crash during projection")
    with pytest.raises(RuntimeError):
        store.apply(snapshot(rev=2, records=[]), crash)
    assert store.revision() == 1 and len(store.records()) == 1
    store.apply(snapshot(rev=2, records=[]))
    with store.transaction() as db:
        assert db.execute("SELECT count(*) FROM edge_runtime").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM edge_operations").fetchone()[0] == 1
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"


def test_delta_gap_duplicates_tombstones(store):
    store.apply(snapshot())
    changes = dict(records=[], deleted=["rack:1"])
    msg = envelope("sim-a", "IPCSIM", "sync.delta", dict(**changes, digest=checksum(changes), base_revision=2), dataset_id="sim-a", revision=3)
    with pytest.raises(RevisionGap):
        store.apply(msg)
    msg["revision"], msg["payload"]["base_revision"] = 2, 1
    assert store.apply(msg) == "applied"
    assert store.records() == []
    assert store.apply(msg) == "duplicate"


def test_cross_domain_rejected(store):
    with pytest.raises(ValueError):
        store.apply(snapshot(records=[{"key": "stock:1", "domain": "IPC"}]))


def test_full_snapshot_repairs_read_model_at_same_revision(store):
    original = snapshot()
    store.apply(original)
    with store.transaction() as db:
        db.execute("DELETE FROM edge_records")
    assert store.revision() == 1
    assert store.apply(original) == "applied"
    assert len(store.records()) == 1


def test_physical_intent_never_replays_after_failure_or_restart(store):
    store.apply(snapshot())
    message = envelope("sim-a", "IPCSIM", "command.execute", {"rack_id": 1}, command_id="op-1", revision=1)
    sent = []
    def write_then_crash(body):
        sent.append(body)
        raise IOError("Lost confirmation after actual write")
    with pytest.raises(IOError):
        store.execute(message, write_then_crash, True)
    restarted = Store(store.path, "sim-a", "IPCSIM")
    assert restarted.execute(message, write_then_crash, True) == "uncertain"
    assert len(sent) == 1


def test_offline_and_wrong_revision_commands_rejected(store):
    store.apply(snapshot())
    msg = envelope("sim-a", "IPCSIM", "command.execute", {"rack_id": 1}, command_id="op", revision=1)
    with pytest.raises(ValueError):
        store.execute(msg, lambda _: pytest.fail("Serial write"), False)
    msg["revision"] = 2
    with pytest.raises(RevisionGap):
        store.execute(msg, lambda _: pytest.fail("Serial write"), True)


def test_signed_envelope_topic_and_registry_identity():
    secret = "a"*48
    msg = snapshot()
    raw = encode(msg, secret)
    assert decode(raw, secret) == msg
    with pytest.raises(ValueError):
        decode(raw, "b"*48)
    with pytest.raises(ValueError):
        validate(topic("other", "down", "sync"), msg, "sim-a", "IPCSIM", "down")
    with pytest.raises(ValueError):
        validate(topic("sim-a", "down", "sync"), msg, "sim-a", "IPC", "down")


def test_serial_adapters_preserve_both_existing_protocols():
    command = {"address": 7, "action": "OPEN"}
    assert SimulationAdapter().encode(command) == "0|7|1"
    assert json.loads(HardwareAdapter().encode(command)) == {"rack_id": 7, "action": "open"}
    assert SimulationAdapter().parse("ENVSTT|7|22|60|80|Có").payload["smoke"] == 1
    assert HardwareAdapter().parse('{"rack_id":7,"temperature":22}').msg_type == "telemetry"
