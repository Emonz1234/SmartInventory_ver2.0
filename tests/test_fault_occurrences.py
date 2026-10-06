import json
import time
from types import SimpleNamespace
import pytest
from test_inventory_workflow import Workflow
from ipc_core.fault_service import FaultService


@pytest.fixture
def faults(tmp_path):
    return Workflow(tmp_path)


def occurrence(w, address=3, codes=None, clear=True):
    w.sim[1].set_errors(address,codes or [1]); w.deliver()
    if clear:
        w.sim[1].set_errors(address,[]); w.deliver()


def overview(w, **kwargs):
    return w.runtime.faults.overview(**kwargs)


def test_normal_active_clear_and_duplicates(faults):
    w=faults
    assert overview(w)['summary']['safety_status']=='SYSTEM NORMAL'
    occurrence(w,clear=False)
    first=overview(w)
    assert first['summary']['active_faults']==1
    assert first['active_faults'][0]['severity']=='CRITICAL'
    assert first['racks'][2]['safety_status']=='ACTIVE FAULT'
    for _ in range(15):
        w.sim[1].set_errors(3,[1]);w.deliver()
    assert overview(w)['summary']['faults_24h']==1
    w.sim[1].set_errors(3,[]);w.deliver()
    cleared=overview(w)
    assert not cleared['active_faults']
    assert cleared['history'][0]['status']=='RESOLVED'
    assert cleared['racks'][2]['safety_status']=='NORMAL'
    assert cleared['summary']['safety_status']=='RECOVERY CONFIRMATION REQUIRED'
    assert cleared['recovery_pending'][0]['cabinet_index']==1


def test_threshold_clear_acknowledge_and_new_occurrence(faults):
    w=faults
    for count in (1,2,3):
        occurrence(w)
        result=overview(w)
        assert result['summary']['faults_24h']==count
        assert len(result['maintenance_warnings'])==(1 if count==3 else 0)
    assert result['racks'][2]['safety_status']=='MAINTENANCE WARNING'
    assert result['summary']['safety_status']=='MAINTENANCE CHECK RECOMMENDED'
    warning=result['maintenance_warnings'][0]
    assert warning['same_fault_repeated'] and not warning['active_fault']
    for _ in range(2):w.runtime.faults.acknowledge(3,warning['latest_occurrence_id'],1,'Operator')
    acknowledged=overview(w)
    assert acknowledged['maintenance_warnings'][0]['maintenance_status']=='ACKNOWLEDGED'
    assert acknowledged['history_total']==3
    with w.runtime.store.transaction() as db:
        assert db.execute('SELECT count(*) FROM maintenance_acknowledgements').fetchone()[0]==1
    occurrence(w,codes=[2],clear=False)
    repeated=overview(w)
    assert repeated['maintenance_warnings'][0]['maintenance_status']=='INSPECTION RECOMMENDED'
    assert repeated['racks'][2]['safety_status']=='ACTIVE FAULT'
    with pytest.raises(ValueError):w.runtime.faults.acknowledge(3,warning['latest_occurrence_id'],1,'Operator')


def test_different_codes_same_rack_and_separate_racks(faults):
    w=faults
    for code in (1,2,3):occurrence(w,codes=[code])
    result=overview(w)
    assert result['maintenance_warnings'][0]['count']==3
    assert not result['maintenance_warnings'][0]['same_fault_repeated']
    w.sim[1].set_errors(3,[1,2]);w.sim[1].set_errors(4,[3]);w.deliver()
    result=overview(w)
    assert {r['address'] for r in result['active_faults']}=={3,4}
    assert result['summary']['faults_24h']==5
    assert len(result['active_faults'][0]['codes'])>=1


def test_communication_loss_never_creates_or_clears_device_fault(faults):
    w=faults
    w.runtime.recovery.lost(1)
    assert overview(w)['summary']['faults_24h']==0
    assert overview(w)['racks'][2]['safety_status']=='UNKNOWN'
    w.deliver();occurrence(w,clear=False)
    w.runtime.recovery.lost(1)
    assert overview(w)['summary']['active_faults']==1
    assert overview(w)['summary']['faults_24h']==1
    w.deliver()
    assert overview(w)['summary']['faults_24h']==1
    w.sim[1].set_errors(3,[]);w.deliver()
    state=w.runtime.recovery.states()[0]
    state['fault_context']=dict(error_code='COMMUNICATION_LOST',rack_id=3,cleared=False)
    state['system_state']='ERROR'
    w.runtime.faults.observe(state)
    assert overview(w)['summary']['faults_24h']==1


def test_window_configuration_filters_pagination_and_restart(faults):
    w=faults
    for _ in range(3):occurrence(w)
    occurrence(w,address=4,codes=[2])
    service=w.runtime.faults
    assert len(service.overview(clock=time.time()+31*60)['maintenance_warnings'])==0
    assert overview(w,cabinet=2)['history_total']==0
    assert overview(w,rack=3,severity='CRITICAL',status='RESOLVED',search='OBSTRUCT')['history_total']==3
    assert overview(w,rack=3,status='ACTIVE')['history_total']==0
    assert len(overview(w,limit=1,offset=1)['history'])==1
    service=FaultService(w.runtime.store,SimpleNamespace(REPEATED_FAULT_THRESHOLD=2,REPEATED_FAULT_WINDOW_MINUTES=60),w.runtime.recovery)
    assert service.overview()['config']=={'threshold':2,'window_minutes':60}
    assert service.overview()['history_total']==4
    assert service.overview()['maintenance_warnings'][0]['count']==3


def test_checkpoint_transaction_and_explicit_system_severity_preserved(faults):
    w=faults;row=w.start()
    w.sim[1].step_operations(1.6);w.sim[1].set_errors(3,[1]);w.deliver()
    record=overview(w)['active_faults'][0]
    assert record['transaction_id']==row['transaction_id']
    assert record['context']['current_step']['rack_id']==w.sim[1].gap_controller.fault_context['moving_rack_id']
    sequence=record['context']['sequence']
    w.deliver()
    assert overview(w)['active_faults'][0]['context']['sequence']==sequence
    state=w.runtime.recovery.states()[1]
    state['fault_context']=dict(error_code='CUSTOM_SENSOR',rack_id=9,severity='WARNING')
    w.runtime.faults.observe(state)
    assert next(r for r in overview(w)['active_faults'] if r['address']==9)['severity']=='WARNING'


def test_backfill_existing_history_counts_episodes_not_messages(faults):
    w=faults
    occurrence(w);occurrence(w);occurrence(w,clear=False)
    with w.runtime.store.transaction() as db:
        db.execute('DELETE FROM fault_occurrences');db.execute('DELETE FROM fault_projection')
    service=FaultService(w.runtime.store,SimpleNamespace(),w.runtime.recovery)
    data=service.overview()
    assert data['history_total']==3
    assert data['summary']['active_faults']==1
    assert data['maintenance_warnings'][0]['count']==3


def test_api_filters_ack_and_requires_operator_session(faults,monkeypatch):
    from fastapi.testclient import TestClient
    from ipc_core.api import app
    from ipc_core.app.core.config import settings
    from ipc_core import operator_api
    w=faults
    for _ in range(3):occurrence(w)
    app.state.runtime=w.runtime
    client=TestClient(app)
    headers={'Authorization':f'Bearer {settings.EDGE_API_TOKEN}'}
    data=client.get('/api/faults/overview?cabinet=1&rack=3&severity=CRITICAL&status=RESOLVED',headers=headers).json()
    assert data['history_total']==3
    assert client.get(f"/api/faults/{data['history'][0]['id']}",headers=headers).json()['status']=='RESOLVED'
    assert client.get('/api/faults/999999',headers=headers).status_code==404
    assert client.get('/api/faults/overview?hours=0',headers=headers).status_code==422
    body={'address':3,'occurrence_id':data['maintenance_warnings'][0]['latest_occurrence_id']}
    assert client.post('/api/operator/maintenance/acknowledge',headers=headers,json=body).status_code==403
    monkeypatch.setattr(operator_api,'session',lambda _: {'identity':{'id':1,'username':'Operator'}})
    assert client.post('/api/operator/maintenance/acknowledge',headers=headers,json=body).status_code==200
    assert overview(w)['maintenance_warnings'][0]['acknowledgement']['username']=='Operator'
