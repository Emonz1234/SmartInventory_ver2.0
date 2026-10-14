import pytest
from test_inventory_workflow import Workflow
from test_esp32_commands import hardware
from ipc_core.operation_history import history

@pytest.fixture
def physical(tmp_path, hardware):
    w = Workflow(tmp_path)
    w.runtime.settings.DEVICE_TYPE = 'IPC'
    w.runtime.recovery = None
    w.tx.recovery = None
    w.runtime.serial = hardware
    hardware.observer = w.runtime.record_serial
    return w

def receive(w, text):
    message = w.runtime.serial.adapter.parse(text)
    w.runtime.serial.observe(message)
    w.runtime.record_serial(message)

@pytest.mark.parametrize('action,endpoint', [('OPEN','OPENED'),('CLOSE','CLOSED')])
def test_physical_history_only_completes_on_ack_then_endpoint(physical, action, endpoint):
    w = physical
    assert w.runtime.store.execute_local('op',103,action,w.runtime.send_checked) == 'local_sent'
    assert history(w.runtime)[0]['execution_state'] == 'unconfirmed'
    receive(w,f'ACK {action} 3')
    assert history(w.runtime)[0]['execution_state'] == 'unconfirmed'
    receive(w,f'STATE 3 {endpoint}')
    assert history(w.runtime)[0]['execution_state'] == 'completed'
    assert history(w.runtime)[0]['completed_at']

@pytest.mark.parametrize('kind,expected', [('PICK',8),('PUT',12)])
def test_physical_inventory_endpoint_workflow(physical, kind, expected):
    w = physical
    row = w.start(kind=kind)
    tid = row['transaction_id']
    receive(w,'ACK OPEN 3')
    assert w.tx.get(tid)['operation_status'] == 'EXECUTING'
    assert w.qty() == 10
    # Idempotent OPEN is permitted without an intermediate OPENING frame.
    receive(w,'STATE 3 OPENED')
    assert w.tx.get(tid)['operation_status'] == 'AWAITING_CONFIRMATION'
    w.tx.confirm(1,tid,True,'Physical count verified',decision_pending=True)
    assert w.qty() == expected
    w.tx.finish(1,tid,'CLOSE')
    receive(w,'ACK CLOSE 3')
    assert w.tx.get(tid)['operation_status'] == 'EXECUTING'
    receive(w,'STATE 3 CLOSED')
    assert w.tx.get(tid)['operation_status'] == 'COMPLETED'
    assert w.qty() == expected

def test_disconnect_is_not_completed_by_reconnect_status(physical):
    w = physical
    w.runtime.store.execute_local('op',103,'OPEN',w.runtime.send_checked)
    w.runtime.serial.disconnect()
    assert history(w.runtime)[0]['execution_state'] == 'fault'
    receive(w,'STATUS 3 OPENED 1 0 100')
    assert history(w.runtime)[0]['execution_state'] == 'fault'

@pytest.mark.parametrize('code',['OPEN_TIMEOUT','SMOKE_ALARM','LIMIT_CONFLICT'])
def test_physical_fault_does_not_apply_inventory(physical, code):
    w = physical
    row = w.start()
    receive(w, f'ERROR 3 {code}')
    assert w.tx.get(row['transaction_id'])['operation_status'] == 'FAILED'
    assert w.qty() == 10
    assert w.runtime.hardware_fault
    receive(w, 'STATE 3 ERROR')
    receive(w, 'STATE 3 CLOSED')
    assert not w.runtime.hardware_fault

def test_unrouted_racks_do_not_fault_local_rack(physical):
    w = physical
    receive(w, 'ERROR 2 INVALID_RACK')
    assert not w.runtime.hardware_fault
    w.runtime.store.execute_local('local-op',103,'OPEN',w.runtime.send_checked)
    receive(w, 'ACK OPEN 3')
    receive(w, 'STATE 3 OPENED')
    assert history(w.runtime)[0]['execution_state'] == 'completed'

def test_unknown_position_clears_reusable_open_evidence(physical):
    w = physical
    receive(w, 'STATUS 3 OPENED 1 0 100')
    with w.runtime.store.transaction() as db:
        assert db.execute('SELECT 1 FROM local_rack_state WHERE address=3').fetchone()
    receive(w, 'STATE 3 UNKNOWN')
    with w.runtime.store.transaction() as db:
        assert not db.execute('SELECT 1 FROM local_rack_state WHERE address=3').fetchone()

def test_position_cache_survives_ipc_restart(tmp_path, hardware):
    from types import SimpleNamespace
    from ipc_core.runtime import Runtime
    from ipc_core.app.serial.serial_manager import SerialManager
    cfg = SimpleNamespace(DB_PATH=str(tmp_path/'physical.db'), DEVICE_ID='physical', DEVICE_TYPE='IPC')
    runtime = Runtime(cfg, hardware)
    hardware.observer = runtime.record_serial
    message = hardware.adapter.parse('STATE 1 OPENED')
    hardware.observe(message)
    runtime.record_serial(message)
    restored = SerialManager('COM9')
    Runtime(cfg, restored)
    assert restored.rack_states[1]['last_confirmed_state'] == 'OPENED'
    assert restored.rack_states[1]['position_stale']
