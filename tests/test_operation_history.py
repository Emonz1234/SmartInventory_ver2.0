import json
import pytest
from test_inventory_workflow import Workflow
from ipc_core.operation_history import history


@pytest.fixture
def operation(tmp_path):
    return Workflow(tmp_path)


def start(w, action='OPEN', key='command'):
    return w.runtime.store.execute_local(key,103,action,w.runtime.send_checked)


@pytest.mark.parametrize('action',['OPEN','HOME','CLOSE','VENTILATE'])
def test_local_execution_tracks_real_completion_and_timestamps(operation,action):
    w=operation
    if action in {'HOME','CLOSE'}:
        start(w,key='setup');w.finish_motion()
    assert start(w,action)=='local_sent'
    row=next(r for r in history(w.runtime) if r['id']=='command')
    assert row['created_at'] and row['execution_state']=='unconfirmed'
    w.sim[1].step_operations(0);w.deliver()
    assert next(r for r in history(w.runtime) if r['id']=='command')['execution_state']=='moving'
    w.finish_motion()
    row=next(r for r in history(w.runtime) if r['id']=='command')
    assert row['execution_state']=='completed' and row['completed_at'] and not row['execution_error']
    completed=row['completed_at']
    w.runtime.recovery.lost(1)
    assert next(r for r in history(w.runtime) if r['id']=='command')['execution_state']=='completed'
    w.runtime.restore_operation_history()
    assert next(r for r in history(w.runtime) if r['id']=='command')['completed_at']==completed


def test_fault_clear_resume_and_offline_do_not_fake_completion(operation):
    w=operation;start(w);w.sim[1].step_operations(0);w.sim[1].step_operations(1.6)
    w.sim[1].set_errors(3,[1]);w.deliver()
    assert history(w.runtime)[0]['execution_state']=='fault'
    assert history(w.runtime)[0]['execution_error']=='OBSTRUCTED'
    assert not history(w.runtime)[0]['completed_at']
    w.runtime.recovery.lost(1)
    assert history(w.runtime)[0]['execution_state']=='communication_lost'
    w.clear(address=3)
    assert history(w.runtime)[0]['execution_state']=='paused'
    w.recover();w.finish_motion()
    assert history(w.runtime)[0]['execution_state']=='completed'
    assert not history(w.runtime)[0]['execution_error']


def test_wrong_command_endpoint_is_not_completion(operation):
    w=operation;start(w);w.sim[1].step_operations(0);w.deliver()
    state=w.runtime.recovery.states()[0]
    state.update(active_command_id=None,last_command_id='another',system_state='OPEN',active_rack=3)
    w.runtime.report_simulation_command(state)
    assert history(w.runtime)[0]['execution_state']=='moving'
    assert not history(w.runtime)[0]['completed_at']


def test_rejected_command_has_reason_and_never_completed(operation):
    w=operation;w.sim[1].set_errors(3,[1]);w.deliver()
    with pytest.raises(ValueError):start(w)
    row=history(w.runtime)[0]
    assert row['execution_state']=='rejected' and row['execution_error']
    assert row['created_at'] and not row['completed_at']


def test_legacy_rows_without_evidence_stay_unconfirmed(operation):
    w=operation
    with w.runtime.store.transaction() as db:
        db.execute('INSERT INTO edge_operations VALUES(?,?,?,NULL)',('old',json.dumps({'address':3,'rack_id':103,'kind':'OPEN'}),'local_sent'))
    row=history(w.runtime)[0]
    assert row['created_at'] is None and row['execution_state']=='unconfirmed'


def test_old_local_completion_and_time_restored_from_real_history(operation):
    w=operation;start(w);w.finish_motion()
    with w.runtime.store.transaction() as db:
        db.execute('DELETE FROM edge_operation_times')
        db.execute('UPDATE edge_operations SET result=NULL')
    before=len(w.commands)
    w.runtime.restore_operation_history()
    row=history(w.runtime)[0]
    assert row['execution_state']=='completed' and row['created_at'] and row['completed_at']
    assert len(w.commands)==before


def test_server_mqtt_vocabulary_unchanged_while_local_ui_shows_paused(operation):
    w=operation
    body={'rack_id':103,'address':3,'action':'OPEN','command_id':'remote'}
    with w.runtime.store.transaction() as db:
        db.execute('INSERT INTO edge_operations VALUES(?,?,?,NULL)',('remote',json.dumps(body),'sent'))
    w.runtime.send_checked(body);w.sim[1].step_operations(0);w.deliver()
    w.sim[1].set_errors(3,[1]);w.deliver();w.clear(address=3)
    assert history(w.runtime)[0]['execution_state']=='paused'
    with w.runtime.store.transaction() as db:
        payloads=[json.loads(row[0])['payload'] for row in db.execute("SELECT body FROM edge_outbox WHERE channel='events'")]
    assert payloads and all(payload['execution_state'] in {'moving','completed','fault'} for payload in payloads)
