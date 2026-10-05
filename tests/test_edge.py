import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from starlette.requests import Request
from ipc_core.store import Store, RevisionGap
from ipc_core.protocol import envelope, checksum, encode, decode, validate, topic
from ipc_core.adapters import HardwareAdapter, SimulationAdapter
from ipc_core.runtime import Runtime
from ipc_core.operator_api import device_command, sessions


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


def test_control_messages_bypass_backlog_and_heartbeat_is_coalesced(store):
    for i in range(150):
        store.emit('events', 'events.serial', {'sequence': i})
    store.emit('status', 'status.heartbeat', {'serial_connected': False})
    latest = store.emit('status', 'status.heartbeat', {'serial_connected': True})
    ack = store.emit('ack', 'ack.applied', {}, correlation_id='snapshot')
    sync = store.emit('sync', 'sync.request', {}, dataset_id='sim-a', revision=0)
    pending = store.pending()
    assert [r['id'] for r in pending[:3]] == [latest['message_id'], ack['message_id'], sync['message_id']]
    with store.transaction() as db:
        assert db.execute("SELECT count(*) FROM edge_outbox WHERE channel='events'").fetchone()[0] == 150
        assert db.execute("SELECT count(*) FROM edge_outbox WHERE channel='status'").fetchone()[0] == 1


def test_outbox_retry_delay_survives_restart(store, monkeypatch):
    monkeypatch.setattr('ipc_core.store.time.time', lambda: 1000)
    msg = store.emit('events', 'events.serial', {})
    store.sent(msg['message_id'])
    reopened = Store(store.path, store.device_id, store.device_type)
    assert reopened.pending() == []
    monkeypatch.setattr('ipc_core.store.time.time', lambda: 1015)
    assert reopened.pending()[0]['id'] == msg['message_id']
    reopened.delivered(msg['message_id'])
    assert reopened.pending() == []


def test_existing_outbox_schema_is_upgraded_without_losing_events(tmp_path):
    path = tmp_path / 'old.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE edge_outbox(id TEXT PRIMARY KEY, channel TEXT, body TEXT, attempts INTEGER DEFAULT 0)')
        msg = envelope('sim-a', 'IPCSIM', 'events.serial', {})
        db.execute('INSERT INTO edge_outbox(id,channel,body) VALUES(?,?,?)', (msg['message_id'], 'events', json.dumps(msg)))
    upgraded = Store(path, 'sim-a', 'IPCSIM')
    assert upgraded.pending()[0]['id'] == msg['message_id']
    upgraded.sent(msg['message_id'])
    assert upgraded.pending() == []


def test_pump_sends_fresh_heartbeat_before_backlog_and_keeps_unpublished_event(tmp_path):
    settings = SimpleNamespace(DB_PATH=str(tmp_path / 'pump.db'), DEVICE_ID='sim-a',
                               DEVICE_TYPE='IPCSIM')
    runtime = Runtime(settings, SimpleNamespace(connected=True))
    for i in range(120):
        runtime.store.emit('events', 'events.serial', {'sequence': i})
    runtime.connected = True
    waits = iter([False, True])
    runtime.stop_event = SimpleNamespace(wait=lambda _: next(waits))
    sent_channels = []

    def publish(route, raw, qos):
        sent_channels.append(route.rsplit('/', 1)[-1])
        return SimpleNamespace(wait_for_publish=lambda timeout: None,
                               is_published=lambda: route.endswith('/status'))

    runtime.client = SimpleNamespace(publish=publish)
    runtime.pump()
    assert sent_channels == ['status', 'status', 'events']  # handshake, heartbeat, business backlog
    with runtime.store.transaction() as db:
        assert db.execute("SELECT count(*) FROM edge_outbox WHERE channel='events' AND sent_at IS NULL").fetchone()[0] == 120
        assert db.execute("SELECT attempts FROM edge_outbox WHERE channel='status'").fetchone()[0] == 1


def test_server_status_logs_follow_lease_and_sync_revision(tmp_path, capsys):
    settings = SimpleNamespace(DB_PATH=str(tmp_path / "runtime.db"), DEVICE_ID="sim-a", DEVICE_TYPE="IPCSIM")
    runtime = Runtime(settings, SimpleNamespace(connected=False))
    runtime.report_server_state()
    assert "[Server] MQTT status: offline" in capsys.readouterr().out

    runtime.store.apply(snapshot())
    runtime.connected = True
    runtime.lease_until = time.time() + 30
    runtime.remote_revision = 1
    runtime.report_server_state()
    output = capsys.readouterr().out
    assert "[Server] MQTT status: online" in output
    assert "[Server] Database synchronized at revision 1" in output

    runtime.lease_until = 0
    runtime.report_server_state()
    assert "[Server] MQTT status: offline" in capsys.readouterr().out


def test_full_sync_duplicate_stale_and_scope(store):
    msg = snapshot()
    assert store.apply(msg) == "applied"
    assert store.apply(msg) == "duplicate"
    store.apply(snapshot(rev=2, records=[]))
    assert store.records() == []
    assert store.apply(msg) == "stale"
    with pytest.raises(ValueError):
        store.apply(snapshot(device="other"))


def test_full_sync_reconciles_higher_local_revision_from_server(store):
    assert store.apply(snapshot(rev=4)) == "applied"
    lower_revision = snapshot(rev=2, records=[])
    assert store.apply(lower_revision, project=lambda db: None, allow_revision_reset=True) == "applied"
    assert store.revision() == 2


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


def test_local_device_commands_work_offline_and_are_idempotent(store):
    store.apply(snapshot(records=[{
        "key": "rack:1", "kind": "rack", "domain": "IPCSIM",
        "data": {"id": 1, "rack_code": "7"}
    }]))
    sent = []

    assert store.execute_local("local-op-1", 1, "OPEN", sent.append) == "local_sent"
    restarted = Store(store.path, "sim-a", "IPCSIM")
    assert restarted.execute_local("local-op-1", 1, "OPEN", sent.append) == "local_sent"
    assert sent == [{"rack_id": 1, "address": 7, "action": "OPEN", "command_id": "local-op-1"}]


def test_local_device_command_resolves_serial_address_when_primary_key_differs(store):
    store.apply(snapshot(records=[{
        "key": "rack:259", "kind": "rack", "domain": "IPCSIM",
        "data": {"id": 259, "rack_code": "1"}
    }]))
    sent = []

    assert store.execute_local("local-address-op", 1, "OPEN", sent.append) == "local_sent"
    assert sent == [{"rack_id": 259, "address": 1, "action": "OPEN", "command_id": "local-address-op"}]


def test_local_uncertain_command_is_not_replayed_after_restart(store):
    store.apply(snapshot(records=[{
        "key": "rack:1", "kind": "rack", "domain": "IPCSIM",
        "data": {"id": 1, "rack_code": "7"}
    }]))
    sent = []

    def write_then_lose_result(body):
        sent.append(body)
        raise IOError("Serial result was lost")

    with pytest.raises(IOError):
        store.execute_local("local-op-2", 1, "CLOSE", write_then_lose_result)
    restarted = Store(store.path, "sim-a", "IPCSIM")
    assert restarted.execute_local("local-op-2", 1, "CLOSE", write_then_lose_result) == "local_uncertain"
    assert len(sent) == 1


def test_local_device_command_api_needs_no_server_but_checks_permission(store):
    store.apply(snapshot(records=[{
        "key": "rack:1", "kind": "rack", "domain": "IPCSIM",
        "data": {"id": 1, "rack_code": "7"}
    }]))
    sent = []
    from ipc_core.auth_service import AuthService
    from ipc_core.local_repository import LocalRepository
    import threading
    with store.transaction() as db:
        for uid, permissions in ((1, ['cabinet.control']), (2, [])):
            record = {'key': f'auth:{uid}', 'kind': 'auth', 'data': {'id': uid, 'version': 'v1', 'permissions': permissions}}
            db.execute('INSERT INTO edge_records VALUES(?,?,?)', ('sim-a', record['key'], json.dumps(record)))
    runtime = SimpleNamespace(
        store=store,
        auth=AuthService(store),
        transactions=SimpleNamespace(repo=LocalRepository(store)),
        operation_lock=threading.RLock(),
        serial=SimpleNamespace(connected=True),
        send_checked=lambda body: sent.append(body)
    )
    app = SimpleNamespace(state=SimpleNamespace(runtime=runtime))

    def request_for(token):
        return Request({
            "type": "http",
            "headers": [(b"x-operator-session", token.encode())],
            "app": app
        })

    expires = time.monotonic() + 60
    sessions["local-command-test"] = {
        "identity": {"id": 1, "permissions": ['cabinet.control']}, "version": 'v1',
        "expires": expires
    }
    sessions["local-command-viewer-test"] = {
        "identity": {"id": 2, "permissions": []}, "version": 'v1',
        "expires": expires
    }
    command = {"rack_id": 1, "kind": "OPEN", "request_key": "local-api-op"}
    try:
        assert device_command(request_for("local-command-test"), command)["state"] == "local_sent"
        assert device_command(request_for("local-command-test"), command)["state"] == "local_sent"
        assert sent == [{"rack_id": 1, "address": 7, "action": "OPEN", "command_id": "local-api-op"}]
        with pytest.raises(HTTPException) as error:
            device_command(request_for("local-command-viewer-test"), command)
        assert error.value.status_code == 403
    finally:
        sessions.pop("local-command-test", None)
        sessions.pop("local-command-viewer-test", None)


def test_offline_and_wrong_revision_commands_rejected(store):
    store.apply(snapshot())
    msg = envelope("sim-a", "IPCSIM", "command.execute", {"rack_id": 1}, command_id="op", revision=1)
    with pytest.raises(ValueError):
        store.execute(msg, lambda _: pytest.fail("Serial write"), False)
    msg["revision"] = 2
    with pytest.raises(RevisionGap):
        store.execute(msg, lambda _: pytest.fail("Serial write"), True)


def test_envelope_topic_and_registry_identity():
    msg = snapshot()
    raw = encode(msg)
    assert decode(raw) == msg
    legacy_raw = json.dumps({"message": msg, "signature": "legacy-signature"})
    assert decode(legacy_raw) == msg
    validate(topic("sim-a", "down", "sync"), decode(legacy_raw), "sim-a", "IPCSIM", "down")
    with pytest.raises(ValueError):
        validate(topic("other", "down", "sync"), msg, "sim-a", "IPCSIM", "down")
    with pytest.raises(ValueError):
        validate(topic("sim-a", "down", "sync"), msg, "sim-a", "IPC", "down")


def test_serial_adapters_preserve_both_existing_protocols():
    command = {"address": 7, "action": "OPEN"}
    assert SimulationAdapter().encode(command) == "0|7|1"
    assert SimulationAdapter().encode({"address": 7, "action": "HOME"}) == "0|7|4"
    with pytest.raises(NotImplementedError):
        HardwareAdapter().encode(command)
    assert SimulationAdapter().parse("ENVSTT|7|22|60|80|Có").payload["smoke"] == 1
    assert HardwareAdapter().parse('{"rack_id":7,"temperature":22}').msg_type == "telemetry"
