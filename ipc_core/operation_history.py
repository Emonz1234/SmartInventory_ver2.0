"""Operator history uses physical evidence, independently of delivery/MQTT state."""
import json
from ipc_core.transaction_service import TransactionService


def execution_result(snapshot, command_id, address, action):
    if snapshot.get('cabinet_index') != (int(address)-1)//6+1:
        return None
    if command_id not in {snapshot.get('active_command_id'),snapshot.get('last_command_id'),(snapshot.get('fault_context') or {}).get('command_id')}:
        return None
    fault=snapshot.get('fault_context') or {}
    if fault and not fault.get('resumed') or snapshot.get('system_state') in {'ERROR','RECOVERING','STOPPED','COMMUNICATION_LOST'}:
        execution='paused' if fault.get('cleared') else 'fault'
    elif snapshot.get('active_command_id') == command_id:
        execution='moving'
    elif snapshot.get('last_command_id') == command_id and TransactionService._safe({**snapshot,'online':True}) and (
        action=='OPEN' and snapshot['system_state']=='OPEN' and snapshot.get('active_rack')==address or
        action=='CLOSE' and snapshot['system_state']=='IDLE' and not snapshot.get('active_rack') or
        action=='HOME' and TransactionService._home_endpoint(snapshot) or
        action=='VENTILATE' and snapshot['system_state']=='VENTILATED'):
        execution='completed'
    else:
        return None
    result=dict(state='sent',execution_state=execution,address=address,action=action,cabinet_index=snapshot['cabinet_index'])
    if fault and not fault.get('resumed'):
        result['error']=fault.get('error_code','Simulation fault')
    return result


def history(runtime, limit=200):
    states={state['cabinet_index']:state for state in runtime.recovery.states()} if runtime.recovery else {}
    with runtime.store.transaction() as db:
        rows=[dict(row) for row in db.execute('''SELECT o.*,t.created_at,t.updated_at,t.completed_at FROM edge_operations o
            LEFT JOIN edge_operation_times t ON t.id=o.id ORDER BY o.rowid DESC LIMIT ?''',(limit,))]
    for row in rows:
        body=json.loads(row['body']); result=json.loads(row['result'] or '{}')
        execution=result.get('execution_state') or ('rejected' if row['state'] in {'rejected','expired'} else 'failed' if row['state']=='failed' else 'unconfirmed')
        error=result.get('error') or ''
        address=body.get('address')
        state=states.get((int(address)-1)//6+1) if address is not None else None
        if execution not in {'completed','rejected','failed'} and state:
            if not state.get('online'):
                execution='communication_lost'
            elif execution=='moving' and row['id'] not in {state.get('active_command_id'),state.get('last_command_id')}:
                execution='unconfirmed'
        row.update(execution_state=execution,execution_error=error,
                   created_at=row['created_at'] or body.get('created_at'))
    return rows
