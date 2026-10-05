"""Server -> real TCP MQTT -> IPC runtime -> actual Simulation controller acceptance."""
import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.db import OperationalError
from django.test import TransactionTestCase, Client
from django.utils import timezone
from sqlalchemy import create_engine
from ipc_core.app.database.database import Base
from ipc_core.app.database.models import inventory, environment, runtime as runtime_models, auth, system
from ipc_core.runtime import Runtime
from ipc_core.adapters import SimulationAdapter
from Simulation.virtual_serial.virtual_master_controller import MasterCom
from .models import Device, Cabinet, Rack, Operation
from .services import assign, confirm_operation, expire_operations
from .mqtt import run_worker
from .test_mqtt_integration import eventually


@skipUnless(os.getenv('MQTT_INTEGRATION') == '1', 'Requires opt-in isolated test MQTT broker')
class ServerCommandIntegration(TransactionTestCase):
    def test_open_close_reject_disconnect_timeout_and_duplicate(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        root = Path(__file__).resolve().parents[2]
        broker = subprocess.Popen(['node', str(root/'tests/mqtt_broker.cjs'), str(port)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertEqual(broker.stdout.readline().decode().strip(), 'READY')
        stop = threading.Event()
        edge = worker = None
        temp_context = tempfile.TemporaryDirectory()
        temp = temp_context.name
        try:
            with patch.dict(os.environ, dict(
                    MQTT_HOST='127.0.0.1', MQTT_PORT=str(port), MQTT_TLS='0',
                    MQTT_USERNAME='inventory-server', MQTT_PASSWORD='test-broker-password')):
                user = get_user_model().objects.create_superuser('command-test', '', 'test-only-password')
                device = Device.objects.create(device_id='command-sim', device_type='IPCSIM', name='Isolated Simulation')
                cabinet = Cabinet.objects.create(code='TEST-C1', name='Test cabinet', domain='IPCSIM', cabinet_index=1)
                racks = [Rack.objects.create(cabinet=cabinet, address=i, rack_index=i, name=f'R{i}') for i in range(1, 7)]
                assign(cabinet.pk, device.pk)
                database = Path(temp)/'edge.sqlite3'
                engine = create_engine(f'sqlite:///{database}')
                Base.metadata.create_all(engine)
                engine.dispose()
                simulation = MasterCom(0, port='')
                cfg = SimpleNamespace(DB_PATH=str(database), DEVICE_ID=device.pk, DEVICE_TYPE='IPCSIM',
                    MQTT_HOST='127.0.0.1', MQTT_PORT=port, MQTT_PASSWORD='test-broker-password', MQTT_TLS=False)
                writes = []
                def send(raw):
                    writes.append(raw)
                    simulation.determine_operationInformation(raw)
                edge = Runtime(cfg, SimpleNamespace(connected=True, send=send))
                worker = threading.Thread(target=run_worker, args=(stop,), daemon=True)
                worker.start()
                edge.start()
                def pump():
                    simulation.step_operations(.4)
                    simulation.publish_state()
                    while not simulation.messages.empty():
                        frame = simulation.messages.get_nowait()
                        message = SimulationAdapter().parse(frame)
                        if message and (message.msg_type != 'simulation_state' or any(r['kind'] == 'rack' for r in edge.store.records())):
                            edge.record_serial(message)
                def wait(predicate, seconds=35):
                    deadline = time.monotonic()+seconds
                    while time.monotonic() < deadline:
                        pump()
                        try:
                            if predicate():
                                return
                        except OperationalError as exc:
                            # SQLite's shared test DB briefly locks during worker commits.
                            if 'locked' not in str(exc):
                                raise
                        time.sleep(.1)
                    self.fail('Timed out waiting for actual Simulation/MQTT evidence')
                wait(lambda: edge.synced and Device.objects.get(pk=device.pk).acknowledged_revision > 0)
                edge.recovery.poll()
                pump()
                client = Client()
                client.force_login(user)
                rack = racks[2]
                def request(action, key):
                    return client.post(f'/api/racks/{rack.pk}/commands',
                        json.dumps(dict(command=action, request_key=key)), content_type='application/json')
                for action in ['OPEN', 'CLOSE']:
                    response = request(action, 'test-'+action)
                    self.assertEqual(response.status_code, 201, response.content)
                    op = Operation.objects.get(pk=response.json()['id'])
                    self.assertEqual(op.execution_state, 'awaiting_device')
                    wait(lambda: Operation.objects.get(pk=op.pk).execution_state == 'completed')
                    self.assertEqual(simulation.gap_controller.system_state, 'OPEN' if action == 'OPEN' else 'IDLE')
                    before = len([w for w in writes if 'EXECUTE' in w])
                    self.assertEqual(request(action, 'test-'+action).json()['id'], str(op.pk))
                    pump()
                    self.assertEqual(len([w for w in writes if 'EXECUTE' in w]), before)
                    self.assertEqual(request('OPEN', 'blocked-'+action).status_code, 400)
                    confirm_operation(user, op.pk, 'Observed actual Simulation endpoint', True)
                    wait(lambda: not edge.store.pending())
                # A reconciled physical interlock rejects a received command; HTTP 201 never implies motion.
                simulation.set_errors(3, [1])
                pump()
                with edge.store.transaction() as db:
                    completed = db.execute('SELECT result FROM edge_operations WHERE id=?', (str(op.pk),)).fetchone()
                self.assertEqual(json.loads(completed['result'])['execution_state'], 'completed')
                response = request('OPEN', 'interlocked')
                self.assertEqual(response.status_code, 201)
                op = Operation.objects.get(pk=response.json()['id'])
                wait(lambda: Operation.objects.get(pk=op.pk).state == 'uncertain')
                self.assertNotEqual(Operation.objects.get(pk=op.pk).execution_state, 'completed')
                row = client.get('/api/operations?source_type=SIMULATION').json()[0]
                self.assertTrue(row['error'])
                confirm_operation(user, op.pk, 'Simulation interlock rejected command; no completion', False)
                # Offline and disconnected-Serial admission remain blocked.
                edge.client.disconnect()
                eventually(lambda: not edge.connected)
                Device.objects.filter(pk=device.pk).update(last_seen=timezone.now()-timedelta(seconds=60))
                self.assertEqual(request('OPEN', 'offline').status_code, 400)
                Device.objects.filter(pk=device.pk).update(last_seen=timezone.now(), serial_connected=False)
                self.assertEqual(request('OPEN', 'no-serial').status_code, 400)
                Device.objects.filter(pk=device.pk).update(serial_connected=True)
                response = request('OPEN', 'timeout')
                self.assertEqual(response.status_code, 201)
                Operation.objects.filter(pk=response.json()['id']).update(expires_at=timezone.now()-timedelta(minutes=2))
                expire_operations()
                op = Operation.objects.get(pk=response.json()['id'])
                self.assertEqual((op.state, op.execution_state), ('uncertain', 'timeout'))
        finally:
            stop.set()
            if edge:
                edge.stop()
            if worker:
                worker.join(timeout=10)
            broker.terminate()
            broker.wait(timeout=10)
            temp_context.cleanup()
