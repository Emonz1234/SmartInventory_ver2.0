"""Local operator API. All authentication and business operations use local state."""
import secrets
import threading
import time
from fastapi import APIRouter, HTTPException, Request
from ipc_core.app.core.config import settings

router = APIRouter(prefix='/api/operator', tags=['operator'])
sessions = {}
guard = threading.Lock()


def session(request):
    key = request.headers.get('X-Operator-Session', '')
    with guard:
        value = sessions.get(key)
        if not value or value['expires'] < time.monotonic():
            sessions.pop(key, None)
            raise HTTPException(403, 'Local session expired; sign in again')
    try:
        current = request.app.state.runtime.auth.identity(user_id=value['identity']['id'])
        if current['version'] != value['version']:
            raise ValueError('Credentials or permissions changed')
    except ValueError as exc:
        with guard:
            sessions.pop(key, None)
        raise HTTPException(403, str(exc)) from None
    return value


@router.post('/login')
def login(request: Request, data: dict):
    runtime = request.app.state.runtime
    try:
        identity = runtime.auth.login(data.get('username', ''), data.get('password', ''))
        version = runtime.auth.identity(user_id=identity['id'])['version']
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from None
    token = secrets.token_urlsafe(32)
    with guard:
        for key in list(sessions):
            if sessions[key]['expires'] < time.monotonic():
                del sessions[key]
        if len(sessions) >= 100:
            raise HTTPException(429, 'Too many local sessions')
        sessions[token] = {'identity': identity, 'version': version, 'expires': time.monotonic()+8*3600}
    return {'session': token, **identity}


@router.post('/logout')
def logout(request: Request):
    with guard:
        sessions.pop(request.headers.get('X-Operator-Session', ''), None)
    return {'authenticated': False}


@router.get('/session')
def current_session(request: Request):
    return session(request)['identity']


@router.post('/maintenance/acknowledge')
def acknowledge_maintenance(request: Request, data: dict):
    identity = session(request)['identity']
    if type(data.get('address')) is not int or type(data.get('occurrence_id')) is not int:
        raise HTTPException(400, 'Maintenance warning address and occurrence ID are required')
    try:
        return request.app.state.runtime.faults.acknowledge(data['address'], data['occurrence_id'], identity['id'], identity['username'])
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.get('/operations')
def operations(request: Request):
    session(request)
    return request.app.state.runtime.transactions.repo.transactions()


def local_ready(runtime):
    if settings.DEVICE_TYPE == 'IPC' and not settings.HARDWARE_ENABLED:
        raise HTTPException(503, 'Physical hardware integration is disabled')
    if not runtime.serial.connected:
        raise HTTPException(503, 'Local Serial is disconnected')


def public_operation(row):
    # Never return the signed authorization credential in API responses.
    return {k: v for k, v in row.items() if k != 'authorization'} | {
        'id': row['transaction_id'], 'kind': row['operation_type'], 'state': row['operation_status'].lower()}


@router.post('/operations')
def operate(request: Request, data: dict):
    if data.get('device_id', settings.DEVICE_ID) != settings.DEVICE_ID:
        raise HTTPException(403, 'Device outside local scope')
    identity = session(request)['identity']
    runtime = request.app.state.runtime
    local_ready(runtime)
    try:
        with runtime.operation_lock:
            return public_operation(runtime.transactions.start(identity['id'], data))
    except (ValueError, KeyError) as exc:
        raise HTTPException(409, str(exc)) from None


@router.post('/device-commands')
def device_command(request: Request, data: dict):
    identity = session(request)['identity']
    runtime = request.app.state.runtime
    try:
        runtime.auth.authorize(identity['id'], 'cabinet.control')
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from None
    action = str(data.get('kind', '')).upper()
    rack_id, key = data.get('rack_id'), data.get('request_key')
    if action not in {'OPEN', 'CLOSE', 'VENTILATE', 'LIGHT', 'HOME', 'LIGHT_OFF'} or type(rack_id) is not int or rack_id < 1:
        raise HTTPException(400, 'Invalid device command')
    if not isinstance(key, str) or not 1 <= len(key) <= 128:
        raise HTTPException(400, 'A stable request_key is required')
    local_ready(runtime)
    try:
        with runtime.operation_lock:
            with runtime.store.transaction() as db:
                if runtime.transactions.repo.active(db):
                    raise ValueError('Finish the active PUT/PICK before issuing another hardware command')
            state = runtime.store.execute_local(key, rack_id, action, runtime.send_checked)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None
    except Exception:
        raise HTTPException(503, 'Serial result uncertain; inspect hardware before retrying') from None
    return {'id': key, 'rack_id': rack_id, 'kind': action, 'state': state}


@router.post('/operations/{operation_id}/confirm')
def confirm(request: Request, operation_id: str, data: dict):
    identity = session(request)['identity']
    if type(data.get('success', True)) is not bool:
        raise HTTPException(400, 'success must be boolean')
    if type(data.get('keep_open', False)) is not bool:
        raise HTTPException(400, 'keep_open must be boolean')
    if type(data.get('decision_pending', False)) is not bool:
        raise HTTPException(400, 'decision_pending must be boolean')
    runtime = request.app.state.runtime
    if data.get('success', True):
        local_ready(runtime)
    try:
        with runtime.operation_lock:
            return public_operation(runtime.transactions.confirm(identity['id'], operation_id,
                                    data.get('success', True), data.get('note', ''), data.get('keep_open', False), data.get('decision_pending', False)))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post('/operations/{operation_id}/finish')
def finish_operation(request: Request, operation_id: str, data: dict):
    identity = session(request)['identity']
    runtime = request.app.state.runtime
    local_ready(runtime)
    try:
        with runtime.operation_lock:
            return public_operation(runtime.transactions.finish(identity['id'], operation_id, data.get('action')))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.get('/simulation-state')
def simulation_state(request: Request):
    session(request)
    runtime = request.app.state.runtime
    if not runtime.recovery:
        raise HTTPException(409, 'Simulation recovery is unavailable for this hardware')
    with runtime.store.transaction() as db:
        history = [dict(row) for row in db.execute('SELECT * FROM simulation_history ORDER BY id DESC LIMIT 100')]
    return {'states': runtime.recovery.states(), 'history': history}


@router.post('/simulation-recovery')
def simulation_recovery(request: Request, data: dict):
    identity = session(request)['identity']
    runtime = request.app.state.runtime
    try:
        runtime.auth.authorize(identity['id'], 'cabinet.control')
        if not runtime.recovery:
            raise ValueError('Simulation only')
        if type(data.get('cabinet_index')) is not int or type(data.get('confirmed', False)) is not bool:
            raise ValueError('Invalid recovery request')
        with runtime.operation_lock:
            request_id = runtime.recovery.recover(data['cabinet_index'], data.get('action'),
                                                  data.get('fault_id'), data.get('confirmed', False))
        return {'request_id': request_id, 'state': 'RECOVERING'}
    except (ValueError, KeyError) as exc:
        raise HTTPException(409, str(exc)) from None


@router.post('/simulation-check')
def simulation_check(request: Request, data: dict):
    session(request)
    runtime = request.app.state.runtime
    try:
        group = data.get('cabinet_index')
        if not runtime.recovery or type(group) is not int or group not in runtime.recovery.groups():
            raise ValueError('Simulation cabinet outside assignment')
        with runtime.operation_lock:
            request_id = runtime.recovery.send(group, 'REQUEST_STATE')
        return {'request_id': request_id, 'state': 'REQUESTED'}
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


@router.post('/simulation-stop')
def simulation_stop(request: Request, data: dict):
    identity = session(request)['identity']
    runtime = request.app.state.runtime
    try:
        runtime.auth.authorize(identity['id'], 'cabinet.control')
        if not runtime.recovery or type(data.get('address')) is not int:
            raise ValueError('Simulation address required')
        group = (data['address']-1)//6+1
        if group not in runtime.recovery.groups():
            raise ValueError('Cabinet outside assignment')
        runtime.recovery.send(group, 'STOP', address=data['address'], error_code='SENSOR_TIMEOUT')
        return {'state': 'ERROR'}
    except (ValueError, KeyError) as exc:
        raise HTTPException(409, str(exc)) from None
