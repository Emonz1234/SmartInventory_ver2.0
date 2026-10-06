"""Real Simulation/IPC journal tests: quantity confirmation is independent of motion."""
import json
from types import SimpleNamespace
import pytest
from Simulation.virtual_serial.virtual_master_controller import MasterCom
from ipc_core.adapters import SimulationAdapter
from ipc_core.runtime import Runtime


class Workflow:
    def __init__(self, directory):
        self.sim = {group: MasterCom(group-1, port='') for group in (1, 2)}
        self.commands = []
        links = {}
        for group, sim in self.sim.items():
            def send(raw, sim=sim):
                body = json.loads(raw)
                if body['operation'] in {'EXECUTE','RESUME','HOME'}:
                    self.commands.append(body)
                assert sim.control(body)
            links[group] = SimpleNamespace(connected=True, send=send)
        cfg = SimpleNamespace(DB_PATH=str(directory/'edge.db'), DEVICE_ID='inventory-sim', DEVICE_TYPE='IPCSIM')
        self.runtime = Runtime(cfg, SimpleNamespace(connected=True, links=links))
        self.tx = self.runtime.transactions
        self.tx.auth = SimpleNamespace(authorize=lambda *_: {'grant': 'test-grant'})
        with self.runtime.store.transaction() as db:
            db.executescript('''CREATE TABLE item_locations(id INTEGER PRIMARY KEY,item_id INTEGER,bin_id INTEGER,quantity INTEGER,UNIQUE(item_id,bin_id));
              CREATE TABLE inventory_transactions(id INTEGER PRIMARY KEY,item_id INTEGER,transaction_type TEXT,quantity INTEGER,reference_no TEXT,user_id INTEGER,created_at TEXT);''')
            records = [('item', {'id':1,'is_active':True})]
            for group in (1, 2):
                records.append(('cabinet', {'id': group,'cabinet_index':group,'status':'demo'}))
                for address in self.sim[group].rack_ids:
                    records += [('rack', {'id':100+address,'cabinet_id':group,'rack_code':str(address)}),
                                ('shelf', {'id':address,'rack_id':100+address}),
                                ('bin', {'id':address,'shelf_id':address,'capacity':100})]
                    db.execute('INSERT INTO item_locations(item_id,bin_id,quantity) VALUES(1,?,10)', (address,))
            for kind, data in records:
                key=f'{kind}:{data["id"]}'
                db.execute('INSERT INTO edge_records VALUES(?,?,?)', ('inventory-sim', key, json.dumps({'key':key,'kind':kind,'data':data})))
            db.execute('INSERT INTO edge_revision VALUES(?,?,?)', ('inventory-sim',1,'test'))
        self.runtime.recovery.poll()
        self.deliver()

    def deliver(self):
        for sim in self.sim.values():
            sim.publish_state()
            while not sim.messages.empty():
                message = SimulationAdapter().parse(sim.messages.get_nowait())
                if message.msg_type == 'simulation_state':
                    self.runtime.record_serial(message)

    def finish_motion(self):
        for _ in range(50):
            for sim in self.sim.values():
                sim.step_operations(0)
                sim.step_operations(4)
            self.deliver()
            if all(not sim.gap_controller.current_command and not sim.gap_controller.pending_commands for sim in self.sim.values()):
                return
        raise AssertionError('Motion did not finish')

    def start(self, address=3, kind='PICK', key='first'):
        return self.tx.start(1, dict(rack_id=100+address,bin_id=address,item_id=1,kind=kind,quantity=2,request_key=key))

    def qty(self, address=3):
        with self.runtime.store.transaction() as db:
            return db.execute('SELECT quantity FROM item_locations WHERE bin_id=?',(address,)).fetchone()[0]

    def clear(self, group=1, address=5):
        self.sim[group].set_errors(address, [])
        self.deliver()

    def recover(self, action='RESUME', group=1):
        state = next(s for s in self.runtime.recovery.states() if s['cabinet_index']==group)
        self.runtime.recovery.recover(group, action, state['fault_context']['fault_id'], True)
        self.deliver()


@pytest.fixture
def workflow(tmp_path):
    return Workflow(tmp_path)


@pytest.mark.parametrize('kind,expected', [('PICK',8),('PUT',12)])
def test_confirm_then_close_commits_once_and_uses_distinct_motion_ids(workflow, kind, expected):
    w=workflow; row=w.start(kind=kind); tid=row['transaction_id']
    w.finish_motion()
    assert w.tx.get(tid)['operation_status']=='AWAITING_CONFIRMATION'
    assert w.qty()==10
    for _ in range(3):
        w.tx.confirm(1,tid,True,'Physical count verified',decision_pending=True)
    assert w.qty()==expected
    assert w.tx.get(tid)['operation_status']=='CONFIRMED'
    assert len([c for c in w.commands if c['operation']=='EXECUTE'])==1
    for _ in range(3):
        w.tx.finish(1,tid,'CLOSE')
    w.finish_motion()
    assert w.tx.get(tid)['operation_status']=='COMPLETED'
    assert w.qty()==expected
    commands=[c for c in w.commands if c['operation']=='EXECUTE']
    assert [c['action'] for c in commands]==['OPEN','HOME']
    snapshot = w.sim[1].gap_snapshot()
    assert snapshot['current_gap'] == 6
    assert not snapshot['active_rack']
    assert all(r['position_mm'] == i * 100 for i, (_, r) in enumerate(sorted(snapshot['racks'].items(), key=lambda entry: int(entry[0]))))
    assert commands[0]['command_id']!=commands[1]['command_id']


def test_keep_open_reuses_only_the_same_rack_then_closes_before_switch(workflow):
    w=workflow; first=w.start();w.finish_motion();tid=first['transaction_id']
    w.tx.confirm(1,tid,True,'Picked',decision_pending=True);w.tx.finish(1,tid,'KEEP_OPEN')
    second=w.start(key='second')
    assert second['phase']=='OPEN_REUSED'
    assert len([c for c in w.commands if c['operation']=='EXECUTE'])==1
    w.tx.confirm(1,second['transaction_id'],True,'Picked',decision_pending=True)
    w.tx.finish(1,second['transaction_id'],'KEEP_OPEN')
    third=w.start(address=9,key='third')
    assert third['phase']=='CLOSE_PREVIOUS'
    assert w.commands[-1]['action']=='HOME' and w.commands[-1]['cabinet_index']==1
    assert not any(c.get('action')=='OPEN' and c['cabinet_index']==2 for c in w.commands)
    w.finish_motion()
    assert w.tx.get(third['transaction_id'])['operation_status']=='AWAITING_CONFIRMATION'
    assert w.sim[1].system_state=='IDLE' and w.sim[2].active_rack==9


@pytest.mark.parametrize('phase',['OPEN','AWAITING','DECISION','CLOSE'])
@pytest.mark.parametrize('action',['RESUME','HOME'])
def test_fault_resume_or_home_preserves_confirmation_and_inventory(workflow,phase,action):
    w=workflow; row=w.start();tid=row['transaction_id'];sim=w.sim[1]
    if phase!='OPEN':w.finish_motion()
    if phase in {'DECISION','CLOSE'}:w.tx.confirm(1,tid,True,'Picked once',decision_pending=True)
    if phase=='CLOSE':w.tx.finish(1,tid,'CLOSE')
    if phase in {'OPEN','CLOSE'}:
        sim.step_operations(0);sim.step_operations(1.6)
    moving=sim.gap_controller.current_step
    address=moving['rack_id'] if moving else 3
    position=sim.gap_controller.racks[address].position_mm
    sim.set_errors(address,[1]);w.deliver()
    assert w.tx.get(tid)['operation_status']=='UNCERTAIN'
    assert w.qty()==(8 if phase in {'DECISION','CLOSE'} else 10)
    with pytest.raises(ValueError):w.recover()
    w.clear(address=address);w.recover(action)
    assert sim.gap_controller.racks[address].position_mm==position
    w.finish_motion()
    result=w.tx.get(tid)
    if action=='HOME':
        assert result['operation_status']==('COMPLETED' if phase in {'DECISION','CLOSE'} else 'CANCELLED')
    else:
        assert result['operation_status']=={'OPEN':'AWAITING_CONFIRMATION','AWAITING':'AWAITING_CONFIRMATION','DECISION':'CONFIRMED','CLOSE':'COMPLETED'}[phase]
    assert w.qty()==(8 if phase in {'DECISION','CLOSE'} else 10)


def test_offline_and_refresh_preserve_active_journal_without_reexecution(workflow):
    w=workflow; row=w.start();tid=row['transaction_id'];w.finish_motion()
    w.runtime.recovery.lost(1)
    with pytest.raises(ValueError):w.tx.confirm(1,tid,True,'Picked',decision_pending=True)
    assert w.qty()==10
    w.deliver()
    assert w.tx.get(tid)['operation_status']=='AWAITING_CONFIRMATION'
    count=len(w.commands)
    w.tx.recover();w.deliver()
    assert w.tx.get(tid)['operation_status']=='AWAITING_CONFIRMATION'
    assert len(w.commands)==count


@pytest.mark.parametrize('action',['RESUME','HOME'])
def test_fault_during_cabinet_switch_never_opens_target_early(workflow,action):
    w=workflow; first=w.start();w.finish_motion();tid=first['transaction_id']
    w.tx.confirm(1,tid,True,'Picked',decision_pending=True);w.tx.finish(1,tid,'KEEP_OPEN')
    second=w.start(address=9,key='switch');sid=second['transaction_id']
    w.sim[1].step_operations(0);w.sim[1].step_operations(1.6)
    w.sim[1].set_errors(3,[1]);w.deliver()
    assert w.tx.get(sid)['phase']=='CLOSE_PREVIOUS'
    assert not any(c.get('action')=='OPEN' and c['cabinet_index']==2 for c in w.commands)
    w.clear(address=3);w.recover(action);w.finish_motion()
    assert w.qty(9)==10
    assert w.tx.get(sid)['operation_status']==('AWAITING_CONFIRMATION' if action=='RESUME' else 'CANCELLED')
    if action=='HOME':assert not any(c.get('action')=='OPEN' and c['cabinet_index']==2 for c in w.commands)


def test_changed_rack_in_same_cabinet_moves_gap_without_home(workflow):
    w=workflow; first=w.start();w.finish_motion();tid=first['transaction_id']
    w.tx.confirm(1,tid,True,'Picked',decision_pending=True);w.tx.finish(1,tid,'KEEP_OPEN')
    second=w.start(address=4,key='different-rack');w.finish_motion()
    assert w.tx.get(second['transaction_id'])['operation_status']=='AWAITING_CONFIRMATION'
    assert [c.get('action') for c in w.commands if c['operation']=='EXECUTE']==['OPEN','OPEN']
    assert w.sim[1].active_rack==4


def test_fault_before_open_keeps_inventory_and_sends_no_command(workflow):
    w=workflow;w.sim[1].set_errors(3,[1]);w.deliver()
    with pytest.raises(ValueError):w.start()
    assert w.qty()==10 and not w.commands


def test_demo_cabinet_offline_cannot_start_inventory_operation(workflow):
    w = workflow
    w.runtime.recovery.lost(1)
    with pytest.raises(ValueError, match='fresh, safe Simulation state'):
        w.start()
    assert w.qty() == 10 and not w.commands


@pytest.mark.parametrize('invalid', ['item', 'location'])
def test_invalid_product_or_location_still_rejected(workflow, invalid):
    w = workflow
    with w.runtime.store.transaction() as db:
        key = 'item:1' if invalid == 'item' else 'shelf:3'
        record = json.loads(db.execute('SELECT body FROM edge_records WHERE key=?', (key,)).fetchone()[0])
        record['data'].update({'is_active': False} if invalid == 'item' else {'rack_id': 104})
        db.execute('UPDATE edge_records SET body=? WHERE key=?', (json.dumps(record), key))
    with pytest.raises(ValueError, match='Invalid product or device location'):
        w.start()
    assert w.qty() == 10 and not w.commands
