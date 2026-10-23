"""Browser bridge to the real IPC journal and two real Simulation groups."""
import contextlib
import json
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_inventory_workflow import Workflow


with tempfile.TemporaryDirectory(prefix='ipcsim-inventory-') as directory:
    with contextlib.redirect_stdout(sys.stderr):
        w = Workflow(Path(directory))
    for line in sys.stdin:
        try:
            data = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                operation = data['operation']
                if operation == 'START':
                    w.tx.start(1, data['body'])
                    for sim in w.sim.values():sim.step_operations(0)
                elif operation == 'CONFIRM':
                    body=data['body'];w.tx.confirm(1,data['id'],body['success'],body['note'],decision_pending=True)
                elif operation == 'FINISH':
                    w.tx.finish(1,data['id'],data['body']['action'])
                    for sim in w.sim.values():sim.step_operations(0)
                elif operation == 'COMPLETE':w.finish_motion()
                elif operation == 'FAULT':
                    w.sim[1].step_operations(1.6)
                    rack=(w.sim[1].gap_controller.current_step or {}).get('rack_id',3)
                    w.sim[1].set_errors(rack,[1])
                elif operation == 'CLEAR':
                    for sim in w.sim.values():
                        for address in sim.rack_ids:sim.set_errors(address,[])
                elif operation == 'DISCONNECT':
                    sim=w.sim[1]
                    sim.step_operations(1.6)
                    address=(sim.gap_controller.current_step or {}).get('rack_id',3)
                    sim._handle_gap_events([sim.gap_controller.inject_fault(address,'COMMUNICATION_LOST')])
                elif operation == 'RECONNECT':
                    w.runtime.recovery.send(1,'REQUEST_STATE')
                elif operation == 'RECOVER':
                    body=data['body'];w.runtime.recovery.recover(body['cabinet_index'],body['action'],body['fault_id'],body['confirmed'])
                    for sim in w.sim.values():sim.step_operations(0)
                elif operation != 'STATE':raise ValueError('Unknown operation')
                w.deliver()
                if operation == 'DISCONNECT': w.runtime.recovery.lost(1)
                records=w.runtime.store.public_records()
                for record in records:
                    row=record['data'];kind=record['kind']
                    if kind=='item':row.update(item_name='Test part',item_code='PART',unit='pcs')
                    if kind=='bin':row['bin_code']=f'B{row["id"]}'
                    if kind=='rack':row['rack_index']=(int(row['rack_code'])-1)%6+1
                result={'states':w.runtime.recovery.states(),'operations':w.tx.repo.transactions(),'records':records,'commands':w.commands}
            print(json.dumps(result),flush=True)
        except Exception as exc:
            print(json.dumps({'error':str(exc)}),flush=True)
