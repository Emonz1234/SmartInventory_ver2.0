"""Interrupted movement, Serial reconciliation and durable fault acceptance cases."""
import json
from types import SimpleNamespace
import pytest
from Simulation.gap_controller import GapMovementController
from Simulation.virtual_serial.virtual_master_controller import MasterCom
from ipc_core.adapters import SimulationAdapter
from ipc_core.store import Store
from ipc_core.recovery_service import RecoveryService


def finish(controller):
    for _ in range(300):
        controller.advance(.5)
        if controller.current_command is None and not controller.pending_commands:
            return
    raise AssertionError('Operation did not finish')


@pytest.mark.parametrize('action', [1, 2, 3, 4])
def test_fault_at_40_percent_resumes_same_step_and_command(action):
    c = GapMovementController(range(1, 7))
    if action in (2, 4):
        c.enqueue(3, 1)
        finish(c)
    c.enqueue(3, action, 'same-command')
    c.advance(0)
    rack = c.racks[c.current_step['rack_id']]
    c.advance(rack.duration_s * .4)
    position, target, progress = rack.position_mm, rack.target_position_mm, c.step_progress
    c.inject_fault(rack.rack_id, 'OBSTRUCTED')
    context = dict(c.fault_context)
    assert rack.position_mm == position and rack.target_position_mm == target
    assert context['progress'] == pytest.approx(40)
    assert not rack.is_moving
    c.advance(100)
    assert rack.position_mm == position
    with pytest.raises(ValueError):
        c.enqueue(1, 1)
    c.recover()
    assert c.system_state == 'RECOVERING'
    assert rack.position_mm == position
    with pytest.raises(ValueError):
        c.resume(context['fault_id'])
    c.resume(context['fault_id'], confirmed=True)
    assert c.command_id == 'same-command' and c.step_progress == progress
    assert rack.position_mm == position
    c.advance(.1)
    assert abs(rack.position_mm - position) == pytest.approx(2.5)
    finish(c)
    assert c.system_state == ('OPEN' if action == 1 else 'VENTILATED' if action == 3 else 'IDLE')
    assert c.fault_context is None


@pytest.mark.parametrize('classification', ['REQUIRES_HOME', 'FATAL'])
def test_untrusted_reference_never_resumes_and_home_does_not_teleport(classification):
    c = GapMovementController(range(1, 7))
    c.enqueue(6, 1)
    c.advance(0)
    c.advance(1.6)
    c.inject_fault(6, 'REFERENCE_LOST', classification, False)
    c.recover()
    position = c.racks[6].position_mm
    with pytest.raises(ValueError):
        c.resume(c.fault_context['fault_id'], True)
    if classification == 'FATAL':
        with pytest.raises(ValueError):
            c.home_recovery(c.fault_context['fault_id'], True)
    else:
        c.home_recovery(c.fault_context['fault_id'], True)
        assert c.racks[6].position_mm == position
        finish(c)
        assert c.racks[6].position_mm == 500


def test_abort_keeps_position_and_requires_explicit_homing():
    c = GapMovementController(range(1, 7))
    c.enqueue(6, 1)
    c.advance(0)
    c.advance(1)
    c.inject_fault(6, 'OBSTRUCTED')
    c.recover()
    fault_id = c.fault_context['fault_id']
    c.abort(fault_id)
    assert c.racks[6].position_mm == 525 and c.system_state == 'STOPPED'
    with pytest.raises(ValueError):
        c.enqueue(6, 1)
    c.home_recovery(fault_id, True)
    finish(c)
    assert c.current_gap == 6


def test_fatal_fault_cannot_be_downgraded_by_reference_or_clear():
    c = GapMovementController(range(1, 7))
    c.inject_fault(6, 'DRIVE_FATAL', 'FATAL', False)
    c.inject_fault(6, 'REFERENCE_LOST', 'REQUIRES_HOME', False)
    c.recover()
    assert c.fault_context['classification'] == 'FATAL'
    with pytest.raises(ValueError):
        c.home_recovery(c.fault_context['fault_id'], True)


def pair(tmp_path):
    sim = MasterCom(0, port='')
    store = Store(tmp_path/'edge.db', 'sim-a', 'IPCSIM')
    with store.transaction() as db:
        for address in range(1, 7):
            record = {'key': f'rack:{address}', 'kind': 'rack', 'data': {'id': address, 'rack_code': str(address)}}
            db.execute('INSERT INTO edge_records VALUES(?,?,?)', ('sim-a', record['key'], json.dumps(record)))
    serial = SimpleNamespace(connected=True, send=lambda raw: sim.determine_operationInformation(raw))
    service = RecoveryService(store, serial)
    return sim, service


def deliver(sim, service):
    sim.publish_state()
    while not sim.messages.empty():
        frame = sim.messages.get_nowait()
        message = SimulationAdapter().parse(frame)
        if message.msg_type == 'simulation_state':
            service.receive(message.payload)


def test_error_clear_reconcile_resume_and_refresh_durable_context(tmp_path):
    sim, edge = pair(tmp_path)
    edge.poll()
    deliver(sim, edge)
    edge.guard(6)
    edge.send(1, 'EXECUTE', address=6, action='OPEN', command_id='open-6')
    sim.step_operations(0)
    sim.step_operations(1.6)
    sim.set_errors(6, [1])
    deliver(sim, edge)
    state = edge.states()[0]
    assert state['system_state'] == 'ERROR'
    assert state['fault_context']['current_position'] == 540
    reopened = RecoveryService(Store(edge.store.path, 'sim-a', 'IPCSIM'), edge.serial)
    assert reopened.states()[0]['fault_context'] == state['fault_context']
    assert reopened.states()[0]['online'] is False
    sim.set_errors(6, [])
    deliver(sim, edge)
    state = edge.states()[0]
    assert state['system_state'] == 'RECOVERING'
    assert 'RESUME' in state['allowed_actions']
    edge.recover(1, 'RESUME', state['fault_context']['fault_id'], True)
    assert sim.gap_controller.racks[6].position_mm == 540
    for _ in range(10):
        sim.step_operations(.5)
    deliver(sim, edge)
    assert edge.states()[0]['system_state'] == 'OPEN'
    assert edge.states()[0]['fault_context'] is None


def test_disconnect_reconnect_requests_state_and_keeps_interrupted_position(tmp_path, monkeypatch):
    sim, edge = pair(tmp_path)
    edge.poll()
    deliver(sim, edge)
    edge.send(1, 'EXECUTE', address=6, action='OPEN', command_id='open-6')
    sim.step_operations(0)
    sim.step_operations(1)
    deliver(sim, edge)
    edge.lost(1)
    assert edge.states()[0]['system_state'] == 'COMMUNICATION_LOST'
    with pytest.raises(ValueError):
        edge.guard(6)
    sim._handle_gap_events([sim.gap_controller.inject_fault(6, 'COMMUNICATION_LOST')])
    edge.send(1, 'REQUEST_STATE')
    deliver(sim, edge)
    state = edge.states()[0]
    assert state['system_state'] == 'RECOVERING'
    assert state['fault_context']['current_position'] == 525
    edge.recover(1, 'RESUME', state['fault_context']['fault_id'], True)
    assert sim.gap_controller.racks[6].position_mm == 525


def test_recoverable_fault_auto_resume_after_matching_snapshot(tmp_path):
    sim, edge = pair(tmp_path)
    edge.poll()
    deliver(sim, edge)
    edge.send(1, 'EXECUTE', address=6, action='OPEN', command_id='auto')
    sim.step_operations(0)
    sim.step_operations(1)
    sim.gap_controller.inject_fault(6, 'TEMPORARY_STOP', 'RECOVERABLE')
    deliver(sim, edge)
    sim.gap_controller.recover()
    deliver(sim, edge)
    assert sim.gap_controller.racks[6].is_moving
    assert sim.gap_controller.racks[6].position_mm == 525


def test_reference_lost_only_offers_home_and_abort(tmp_path):
    sim, edge = pair(tmp_path)
    edge.poll()
    deliver(sim, edge)
    sim.gap_controller.inject_fault(6, 'REFERENCE_LOST', 'REQUIRES_HOME', False)
    sim.gap_controller.recover()
    deliver(sim, edge)
    state = edge.states()[0]
    assert 'RESUME' not in state['allowed_actions']
    with pytest.raises(ValueError):
        edge.recover(1, 'RESUME', state['fault_context']['fault_id'], True)


def test_wrong_session_and_stale_snapshot_cannot_clear_fault(tmp_path):
    sim, edge = pair(tmp_path)
    edge.poll()
    deliver(sim, edge)
    sim.gap_controller.inject_fault(6, 'SENSOR_TIMEOUT')
    deliver(sim, edge)
    state = edge.states()[0]
    old = dict(state, system_state='IDLE', fault_context=None)
    assert not edge.receive(old)
    old.update(sequence=100000, peer_session='other-edge')
    assert not edge.receive(old)
    assert edge.states()[0]['fault_context']['error_code'] == 'SENSOR_TIMEOUT'


def test_simulator_restart_adopts_clean_home_and_archives_pending_command(tmp_path):
    sim, edge = pair(tmp_path)
    edge.poll()
    deliver(sim, edge)
    old = edge.states()[0]
    edge.send(1, 'EXECUTE', address=6, action='OPEN', command_id='interrupted')
    sim.step_operations(0)
    deliver(sim, edge)
    with edge.store.transaction() as db:
        db.execute('''INSERT INTO local_transactions(transaction_id,request_key,ipc_id,operation_type,product_id,cabinet_id,
            rack_id,location_id,address,quantity,user_id,authorization,created_at,operation_status,phase,moving)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            ('interrupted','restart-test','sim-a','PICK',1,1,6,1,6,2,1,'test','2026-10-04','EXECUTING','OPEN',1))
    sim.boot_id = 'new-boot'
    sim.gap_controller.reset()
    deliver(sim, edge)
    deliver(sim, edge)
    state = edge.guard(6)
    assert state['system_state'] == 'IDLE' and state['current_gap'] == 6
    assert state['fault_context'] is None and state['active_command_id'] is None
    with edge.store.transaction() as db:
        archived = json.loads(db.execute("SELECT body FROM simulation_history WHERE event='simulation_restarted'").fetchone()[0])
        journal = db.execute('SELECT operation_status,moving FROM local_transactions').fetchone()
        assert tuple(journal) == ('CANCELLED', 0)
    assert archived['active_command_id'] == 'interrupted'
    old['sequence'] = 100000
    assert not edge.receive(old)
    assert edge.guard(6)['boot_id'] == 'new-boot'


def test_simulator_restart_without_clean_home_stays_locked(tmp_path):
    sim, edge = pair(tmp_path)
    edge.poll()
    deliver(sim, edge)
    edge.send(1, 'EXECUTE', address=6, action='OPEN', command_id='interrupted')
    sim.step_operations(0)
    sim.step_operations(1)
    deliver(sim, edge)
    sim.boot_id = 'unsafe-new-boot'
    deliver(sim, edge)
    assert edge.states()[0]['fault_context']['error_code'] == 'STATE_MISMATCH'
    with pytest.raises(ValueError):
        edge.guard(6)


def test_low_baud_snapshot_fits_serial_frame_and_decompression_is_bounded(tmp_path):
    sim, edge = pair(tmp_path)
    edge.poll()
    sim.gap_controller.inject_fault(6, 'SENSOR_TIMEOUT')
    sim.publish_state()
    snapshots = []
    while not sim.messages.empty():
        raw = sim.messages.get_nowait()
        if raw.startswith('SIMSTT|'):
            snapshots.append(raw)
            assert len(raw) < 8192
            assert SimulationAdapter().parse(raw).msg_type == 'simulation_state'
    assert snapshots
    import base64, zlib
    raw = 'SIMSTT|' + base64.b64encode(zlib.compress(b' ' * 70000)).decode()
    with pytest.raises(ValueError):
        SimulationAdapter().parse(raw)


def test_timeout_stops_in_place_and_history_survives_reopen(tmp_path):
    sim, edge = pair(tmp_path)
    edge.poll()
    deliver(sim, edge)
    edge.send(1, 'EXECUTE', address=6, action='OPEN', command_id='timeout')
    sim.step_operations(0)
    sim.step_operations(1)
    deliver(sim, edge)
    with edge.store.transaction() as db:
        state = json.loads(db.execute('SELECT body FROM simulation_state').fetchone()[0])
        state['operation_started_at'] = 0
        db.execute('UPDATE simulation_state SET body=?', (json.dumps(state),))
    deliver(sim, edge)
    assert sim.system_state == 'ERROR'
    assert sim.gap_controller.racks[6].position_mm == 525
    reopened = RecoveryService(Store(edge.store.path, 'sim-a', 'IPCSIM'), edge.serial)
    with reopened.store.transaction() as db:
        events = [r[0] for r in db.execute('SELECT event FROM simulation_history')]
    assert 'movement_started' in events


def test_resumed_close_commits_local_inventory_once(tmp_path):
    from ipc_core.runtime import Runtime
    from uuid import uuid4
    sim, setup = pair(tmp_path)
    runtime = Runtime(SimpleNamespace(DB_PATH=setup.store.path, DEVICE_ID='sim-a', DEVICE_TYPE='IPCSIM'), setup.serial)
    edge = runtime.recovery
    edge.poll()
    deliver(sim, edge)
    sim.gap_controller.enqueue(6, 1)
    finish(sim.gap_controller)
    tid = str(uuid4())
    with runtime.store.transaction() as db:
        db.executescript('''CREATE TABLE item_locations(item_id INTEGER,bin_id INTEGER,quantity INTEGER,UNIQUE(item_id,bin_id));
            CREATE TABLE inventory_transactions(item_id INTEGER,transaction_type TEXT,quantity INTEGER,reference_no TEXT,user_id INTEGER,created_at TEXT);
            INSERT INTO item_locations VALUES(1,1,10);''')
        db.execute('''INSERT INTO local_transactions(transaction_id,request_key,ipc_id,operation_type,product_id,cabinet_id,
            rack_id,location_id,address,quantity,user_id,authorization,created_at,operation_status,phase,moving)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
            (tid,tid,'sim-a','PICK',1,1,6,1,6,2,1,'test-grant','2026-10-04T00:00:00+00:00','EXECUTING','CLOSE',1))
    edge.send(1,'EXECUTE',address=6,action='CLOSE',command_id=tid)
    sim.step_operations(0)
    sim.step_operations(1.6)
    sim.set_errors(6,[1])
    deliver(sim,edge)
    with runtime.store.transaction() as db:
        assert db.execute('SELECT operation_status FROM local_transactions').fetchone()[0]=='UNCERTAIN'
        assert db.execute('SELECT quantity FROM item_locations').fetchone()[0]==10
    sim.set_errors(6,[])
    deliver(sim,edge)
    edge.recover(1,'RESUME',edge.states()[0]['fault_context']['fault_id'],True)
    for _ in range(10):
        sim.step_operations(.5)
    while not sim.messages.empty():
        runtime.record_serial(SimulationAdapter().parse(sim.messages.get_nowait()))
    runtime.record_serial(SimulationAdapter().parse('OPRSTT|6|0|0|0|1|-1'))
    with runtime.store.transaction() as db:
        assert db.execute('SELECT operation_status FROM local_transactions').fetchone()[0]=='COMPLETED'
        assert db.execute('SELECT quantity FROM item_locations').fetchone()[0]==8
        assert db.execute('SELECT count(*) FROM inventory_transactions').fetchone()[0]==1
