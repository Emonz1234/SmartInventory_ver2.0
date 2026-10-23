"""Real fault service + real Simulation bridge for operator-page browser checks."""
import contextlib
import json
import sys
import tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from test_inventory_workflow import Workflow
from ipc_core.operation_history import history as operation_history

with tempfile.TemporaryDirectory(prefix='ipcsim-faults-') as directory:
    with contextlib.redirect_stdout(sys.stderr):w=Workflow(Path(directory))
    offline=False
    for line in sys.stdin:
        try:
            data=json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                operation=data['operation']
                if operation=='COMMAND':
                    w.runtime.store.execute_local(data['id'],103,data.get('action','OPEN'),w.runtime.send_checked)
                    w.sim[1].step_operations(0)
                elif operation=='COMPLETE':w.finish_motion()
                elif operation=='RECOVER':w.recover(data.get('action','RESUME'))
                elif operation=='FAULT':w.sim[1].set_errors(data.get('address',3),data.get('codes',[1]))
                elif operation=='CLEAR':w.sim[1].set_errors(data.get('address',3),[])
                elif operation=='OFFLINE':offline=True;w.runtime.recovery.lost(1)
                elif operation=='ONLINE':offline=False
                elif operation=='ACK':w.runtime.faults.acknowledge(data['address'],data['occurrence_id'],1,'Operator')
                elif operation not in {'OVERVIEW','DETAIL'}:raise ValueError('Unknown bridge operation')
                if not offline:w.deliver()
                filters=data.get('filters',{})
                result={'overview':w.runtime.faults.overview(**filters), 'states':w.runtime.recovery.states(),
                        'records':w.runtime.store.public_records(), 'commands':w.commands,'operation_history':operation_history(w.runtime)}
            print(json.dumps(result),flush=True)
        except Exception as exc:print(json.dumps({'error':str(exc)}),flush=True)
