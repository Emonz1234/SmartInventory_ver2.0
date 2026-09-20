"""Local React gateway to authenticated central operations; never writes master data."""
import secrets
import threading
import time
from fastapi import APIRouter, HTTPException, Request
from ipc_core.app.core.config import settings
from ipc_core.operator_client import OperatorClient

router = APIRouter(prefix='/api/operator', tags=['operator'])
sessions = {}
guard = threading.Lock()


def session(request):
    key = request.headers.get('X-Operator-Session', '')
    with guard:
        value = sessions.get(key)
        if not value or value['expires'] < time.monotonic():
            sessions.pop(key, None)
            raise HTTPException(403, 'Đăng nhập tài khoản Server để thao tác')
        return value


@router.post('/login')
def login(data: dict):
    if not settings.SERVER_URL:
        raise HTTPException(503, 'Chưa cấu hình SERVER_URL')
    client = OperatorClient(settings.SERVER_URL)
    try:
        identity = client.login(data.get('username', ''), data.get('password', ''))
    except Exception:
        raise HTTPException(403, 'Đăng nhập thất bại hoặc Server không truy cập được') from None
    token = secrets.token_urlsafe(32)
    with guard:
        for key in list(sessions):
            if sessions[key]['expires'] < time.monotonic():
                del sessions[key]
        if len(sessions) >= 100:
            raise HTTPException(429, 'Quá nhiều phiên đăng nhập')
        sessions[token] = {'client': client, 'expires': time.monotonic()+8*3600, 'lock': threading.Lock()}
    return {'session': token, **identity}


@router.post('/logout')
def logout(request: Request):
    with guard:
        sessions.pop(request.headers.get('X-Operator-Session', ''), None)
    return {'authenticated': False}


def central(request, path, method='GET', body=None):
    identity = session(request)
    try:
        with identity['lock']:
            return identity['client'].request(path, method, body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except Exception:
        raise HTTPException(503, 'Server không phản hồi; kiểm tra lịch sử trước khi gửi lại') from None


@router.get('/operations')
def operations(request: Request):
    from urllib.parse import urlencode
    rows = central(request, 'operations?' + urlencode({'device_id': settings.DEVICE_ID}))
    return [row for row in rows if row['device_id'] == settings.DEVICE_ID]


@router.post('/operations')
def operate(request: Request, data: dict):
    if data.get('device_id', settings.DEVICE_ID) != settings.DEVICE_ID:
        raise HTTPException(403, 'Không được điều khiển device khác qua edge này')
    runtime = request.app.state.runtime
    if not runtime.synced:
        raise HTTPException(409, 'Thiết bị phải online và đồng bộ; offline chỉ đọc cache')
    data = {**data, 'device_id': settings.DEVICE_ID}
    return central(request, 'operations', 'POST', data)


@router.post('/operations/{operation_id}/confirm')
def confirm(request: Request, operation_id: str, data: dict):
    # Server authoritative scope check before forwarding confirmation.
    rows = operations(request)
    if not any(row['id'] == operation_id for row in rows):
        raise HTTPException(404, 'Không tìm thấy lệnh trong phạm vi thiết bị')
    return central(request, f'operations/{operation_id}/confirm', 'POST', data)
