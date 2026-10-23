from types import SimpleNamespace
from test_inventory_workflow import Workflow
import ipc_core.api as api


def test_health_explains_fault_and_recovery(tmp_path, monkeypatch):
    w = Workflow(tmp_path)
    monkeypatch.setattr(api.app.state, 'runtime', w.runtime, raising=False)
    monkeypatch.setattr(api, 'serial_manager', SimpleNamespace(connected=True, links={}, adapter=SimpleNamespace(supports_commands=True)))
    monkeypatch.setattr(api, 'serial_status', lambda: {'groups': {1: True}})
    assert api.health()['fault_reasons'] == []
    w.sim[1].set_errors(3, [1]); w.deliver()
    result = api.health()
    assert result['hardware_status'] == 'FAULT'
    reason = next(r for r in result['fault_reasons'] if r.get('cabinet_index') == 1)
    assert reason['error_code'] and reason['rack_id'] == 3
    w.sim[1].set_errors(3, []); w.deliver()
    reason = next(r for r in api.health()['fault_reasons'] if r.get('cabinet_index') == 1)
    assert reason['cleared'] and reason['system_state'] == 'RECOVERING'
    w.runtime.hardware_fault = True
    w.runtime.hardware_fault_details = {'rack_id': 8, 'is_skewed': True}
    assert any(r['error_code'] == 'SKEWED' and r['cabinet_index'] == 2 for r in api.health()['fault_reasons'])


def test_health_explains_uncertain_transaction(tmp_path, monkeypatch):
    w = Workflow(tmp_path)
    monkeypatch.setattr(api.app.state, 'runtime', w.runtime, raising=False)
    monkeypatch.setattr(api, 'serial_manager', SimpleNamespace(connected=True, links={}, adapter=SimpleNamespace(supports_commands=True)))
    monkeypatch.setattr(api, 'serial_status', lambda: {'groups': {1: True}})
    w.start()
    with w.runtime.store.transaction() as db:
        db.execute("UPDATE local_transactions SET operation_status='UNCERTAIN'")
    reason = next(r for r in api.health()['fault_reasons'] if r['error_code'] == 'TRANSACTION_UNCERTAIN')
    assert reason['command_id'] and reason['cabinet_index'] == 1 and reason['rack_id'] == 3


def test_partial_disconnect_is_not_global_fault(tmp_path, monkeypatch):
    w = Workflow(tmp_path)
    monkeypatch.setattr(api.app.state, 'runtime', w.runtime, raising=False)
    monkeypatch.setattr(api, 'serial_manager', SimpleNamespace(connected=True, links={}, adapter=SimpleNamespace(supports_commands=True)))
    monkeypatch.setattr(api, 'serial_status', lambda: {'groups': {1: True, 2: False}})
    states = [{'cabinet_index': 1, 'online': True, 'system_state': 'IDLE'},
              {'cabinet_index': 2, 'online': False, 'system_state': 'COMMUNICATION_LOST',
               'fault_context': {'error_code': 'COMMUNICATION_LOST'}}]
    monkeypatch.setattr(w.runtime.recovery, 'states', lambda: states)
    result = api.health()
    assert result['hardware_status'] == 'ONLINE'
    assert result['fault_reasons'] == []
    assert result['simulation_states'][1]['system_state'] == 'COMMUNICATION_LOST'
    states[0].update(online=False, system_state='COMMUNICATION_LOST')
    result = api.health()
    assert result['hardware_status'] == 'FAULT'
    assert all(r['error_code'] == 'COMMUNICATION_LOST' for r in result['fault_reasons'])
    states[0].update(online=True, system_state='ERROR', fault_context={'error_code': 'OBSTRUCTED'})
    result = api.health()
    assert result['hardware_status'] == 'FAULT'
    assert [r['error_code'] for r in result['fault_reasons']] == ['OBSTRUCTED']
