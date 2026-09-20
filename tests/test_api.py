"""Run application imports in an isolated process so instance settings cannot leak."""
import os
import subprocess
import sys


def test_both_launchers_use_shared_api_and_database(tmp_path):
    code = '''
from fastapi.testclient import TestClient
from ipc_core.api import app
import IPC.main, IPCSIM.main
assert IPC.main.app is IPCSIM.main.app
with TestClient(app) as c:
    assert c.get('/api/inventory').status_code == 401
    h={'Authorization':'Bearer test-token'}
    assert c.get('/api/inventory',headers=h).status_code == 200
    assert c.get('/api/items/search?q=part',headers=h).status_code == 200
    assert c.get('/api/system/health',headers=h).json()['server_synced'] is False
    assert c.get('/api/dashboard/summary',headers=h).json()['system_status']['server_synced'] is False
    assert c.post('/api/transactions/pick',headers=h,json={}).status_code == 409
    assert c.get('/api/racks/1/open',headers=h).status_code == 409
    assert c.post('/api/operator/login',json={}).status_code == 401
    assert c.get('/api/operator/operations',headers=h).status_code == 403
    assert c.post('/api/operator/operations',headers=h,json={'device_id':'other'}).status_code == 403
    assert c.post('/api/operator/operations',headers=h,json={}).status_code == 409
    assert c.get('/api/device/snapshot',headers=h).json()['records'] == []
    assert c.get('/ui/').status_code in (200, 503)
'''
    env = dict(os.environ, DEVICE_ID="test-api", DEVICE_TYPE="IPCSIM", DB_PATH=str(tmp_path/"api.db"), EDGE_API_TOKEN="test-token", SERIAL_PORT="", MQTT_HOST="")
    subprocess.run([sys.executable,"-c",code],env=env,check=True)
