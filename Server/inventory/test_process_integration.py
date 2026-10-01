"""Server HTTP, worker, broker, edge API and actual simulator in separate processes."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen
from unittest import skipUnless
from django.test import TransactionTestCase
from django.db import connection
from django.contrib.auth import get_user_model
from django.core.management import call_command
import io
from ipc_core.operator_client import OperatorClient, read_edge
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Outbox, RuntimeEvent
from .services import assign
from .test_mqtt_integration import eventually


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


@skipUnless(os.getenv('MQTT_INTEGRATION') == '1' and connection.vendor == 'postgresql',
            'Requires isolated PostgreSQL and MQTT_INTEGRATION=1')
class ProcessIntegration(TransactionTestCase):
    def test_http_mqtt_serial_simulation_recovery(self):
        root = Path(__file__).resolve().parents[2]
        ports = [free_port() for _ in range(7)]
        broker_port, serial_port, api_port, server_port, physical_port, serial_port_two, web_port = ports
        processes, logs = [], []
        with tempfile.TemporaryDirectory() as temp:
            temp = Path(temp)
            def launch(name, args, env=None):
                log = (temp / (name + '.log')).open('ab')
                logs.append(log)
                child = subprocess.Popen(args, cwd=root, env=env, stdout=log, stderr=log,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                processes.append(child)
                return child
            def kill(child):
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=10)
            try:
                get_user_model().objects.create_superuser('process-operator', '', 'test-only-password')
                call_command('bootstrap_inventory', sim_device_id='process-sim', demo_catalog=True, stdout=io.StringIO())
                device = Device.objects.get(pk='process-sim')
                rack = Rack.objects.get(cabinet__device=device, address=1)
                cabinet = rack.cabinet
                shelf = Shelf.objects.create(rack=rack, code='S')
                bin_obj = Bin.objects.create(shelf=shelf, code='B')
                item = Item.objects.create(code='PART', name='Part', unit='piece')
                Stock.objects.create(item=item, bin=bin_obj, quantity=10)
                assign(cabinet.pk, device.pk)
                env = os.environ.copy()
                env.pop('SERVER_TEST_SQLITE', None)
                db = connection.settings_dict
                env.update(POSTGRES_DB=db['NAME'], POSTGRES_USER=db['USER'], POSTGRES_PASSWORD=db['PASSWORD'],
                    POSTGRES_HOST=db['HOST'], POSTGRES_PORT=str(db['PORT']), DJANGO_SECRET_KEY='process-test-secret',
                    DJANGO_ALLOWED_HOSTS='127.0.0.1', DJANGO_CSRF_TRUSTED_ORIGINS=f'http://127.0.0.1:{server_port},http://127.0.0.1:{web_port}',
                    MQTT_HOST='127.0.0.1', MQTT_PORT=str(broker_port), MQTT_TLS='0',
                    MQTT_USERNAME='inventory-server', MQTT_PASSWORD='test-broker-password')
                broker_args = ['node', str(root/'tests/mqtt_broker.cjs'), str(broker_port)]
                broker = launch('broker', broker_args)
                simulation_args = [sys.executable, 'tests/serial_peer.py', '--port', str(serial_port), '--log', str(temp/'commands.txt')]
                simulation = launch('simulation', simulation_args)
                launch('simulation-two', [sys.executable, 'tests/serial_peer.py', '--port', str(serial_port_two),
                    '--group', '2', '--log', str(temp/'commands-two.txt')])
                worker_args = [sys.executable, 'Server/manage.py', 'mqtt_worker']
                worker = launch('worker', worker_args, env)
                launch('http', [sys.executable, 'Server/manage.py', 'runserver', f'127.0.0.1:{server_port}', '--noreload'], env)
                if os.getenv('UI_INTEGRATION') == '1':
                    launch('web', ['node', 'Server/frontend/node_modules/vite/bin/vite.js', 'Server/frontend',
                        '--config', 'Server/frontend/vite.config.js', '--host', '127.0.0.1', '--port', str(web_port)],
                        env | {'SERVER_API_URL': f'http://127.0.0.1:{server_port}'})
                edge_env = env | dict(DEVICE_ID=device.pk, DEVICE_TYPE='IPCSIM',
                    SERVER_URL=f'http://127.0.0.1:{server_port}',
                    SERIAL_GROUP_PORTS=json.dumps({'1': f'socket://127.0.0.1:{serial_port}', '2': f'socket://127.0.0.1:{serial_port_two}'}),
                    DB_PATH=str(temp/'edge.sqlite3'), EDGE_API_TOKEN='local-test-token', SERIAL_PORT='',
                    EDGE_ENV_FILE=str(temp/'absent.env'))
                edge_args = [sys.executable, '-m', 'uvicorn', 'ipc_core.api:app', '--host', '127.0.0.1', '--port', str(api_port)]
                edge = launch('edge', edge_args, edge_env)
                physical = Device.objects.get(pk='IPC01')
                physical_env = edge_env | dict(DEVICE_ID=physical.pk, DEVICE_TYPE='IPC',
                    DB_PATH=str(temp/'physical.sqlite3'), SERIAL_PORT='', SERIAL_GROUP_PORTS='{}', HARDWARE_ENABLED='false')
                launch('physical', [sys.executable, '-m', 'uvicorn', 'ipc_core.api:app', '--host', '127.0.0.1', '--port', str(physical_port)], physical_env)
                def physical_snapshot():
                    try:
                        return read_edge(f'http://127.0.0.1:{physical_port}', 'local-test-token')
                    except Exception:
                        return {}
                def snapshot():
                    try:
                        return read_edge(f'http://127.0.0.1:{api_port}', 'local-test-token')
                    except Exception:
                        return {}
                eventually(lambda: snapshot().get('health', {}).get('server_synced'), seconds=60)
                eventually(lambda: physical_snapshot().get('health', {}).get('server_synced'), seconds=60)
                self.assertEqual(sum(r['kind']=='cabinet' for r in snapshot()['records']), 22)
                self.assertEqual(sum(r['kind']=='rack' for r in snapshot()['records']), 132)
                self.assertEqual(sum(r['kind']=='cabinet' for r in physical_snapshot()['records']), 1)
                self.assertFalse(physical_snapshot()['health']['serial_connected'])
                self.assertEqual(sum(r['kind']=='rack' for r in physical_snapshot()['records']), 6)
                def edge_api(path, data=None, session_token=''):
                    request = Request(f'http://127.0.0.1:{api_port}/api/operator/{path}',
                        data=json.dumps(data).encode() if data is not None else None,
                        headers={'Authorization': 'Bearer local-test-token', 'Content-Type': 'application/json',
                                 'X-Operator-Session': session_token})
                    with urlopen(request, timeout=10) as response:
                        return json.load(response)
                with urlopen(f'http://127.0.0.1:{api_port}/ui/') as response:
                    self.assertIn(b'<div id="root">', response.read())
                operator_session = edge_api('login', {'username': 'process-operator', 'password': 'test-only-password'})['session']
                client = OperatorClient(f'http://127.0.0.1:{server_port}')
                self.assertTrue(client.login('process-operator', 'test-only-password')['authenticated'])
                if os.getenv('UI_INTEGRATION') == '1':
                    edited = subprocess.run(['node', 'tests/server_browser.cjs', f'http://127.0.0.1:{web_port}', str(item.pk), str(cabinet.pk)],
                        cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=90)
                    self.assertEqual(edited.returncode, 0, edited.stdout + edited.stderr)
                    eventually(lambda: any(r['kind']=='cabinet' and r['data']['description']=='Edited in React Admin' for r in snapshot().get('records', [])))
                else:
                    client.request('items', 'PATCH', {'id': item.pk, 'name': 'Updated remotely'})
                eventually(lambda: any(r['kind']=='item' and r['data']['item_name']=='Updated remotely' for r in snapshot().get('records', [])))
                eventually(lambda: Device.objects.get(pk=device.pk).revision == Device.objects.get(pk=device.pk).acknowledged_revision)
                if os.getenv('UI_INTEGRATION') == '1':
                    rendered = subprocess.run(['node', 'tests/edge_browser.cjs', f'http://127.0.0.1:{api_port}',
                        str(rack.pk), str(cabinet.pk), f'http://127.0.0.1:{physical_port}'], cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=90)
                    self.assertEqual(rendered.returncode, 0, rendered.stdout + rendered.stderr)
                    created = json.loads(rendered.stdout.strip().splitlines()[-1])
                else:
                    created = edge_api('operations', dict(rack_id=rack.pk, bin_id=bin_obj.pk,
                        item_id=item.pk, kind='PICK', quantity=2, request_key='process-command'), operator_session)
                op_id = created['id']
                eventually(lambda: Operation.objects.get(pk=op_id).execution_state == 'completed', seconds=45)
                self.assertEqual(Stock.objects.get(bin=bin_obj).quantity, 10)
                Outbox.objects.filter(device=device, body__message_type='command.execute').update(acknowledged=False, sent_at=None)
                eventually(lambda: not Outbox.objects.filter(device=device, body__message_type='command.execute', acknowledged=False).exists())
                self.assertEqual((temp/'commands.txt').read_text().splitlines(), ['0|1|1'])
                edge_api(f'operations/{op_id}/confirm', {'success': True, 'note': 'Counted two pieces in process integration'}, operator_session)
                eventually(lambda: not snapshot().get('pending', [1]))
                self.assertEqual(Stock.objects.get(bin=bin_obj).quantity, 8)
                second_rack = Rack.objects.get(cabinet__device=device, address=7)
                eventually(lambda: snapshot()['health']['server_synced'])
                second = edge_api('operations', dict(rack_id=second_rack.pk, kind='LIGHT', request_key='second-group-light'), operator_session)
                eventually(lambda: Operation.objects.get(pk=second['id']).state == 'sent')
                self.assertEqual((temp/'commands-two.txt').read_text().splitlines(), ['0|7|0'])
                edge_api(f"operations/{second['id']}/confirm", {'success': True, 'note': 'Observed simulation group two light'}, operator_session)
                old_count = RuntimeEvent.objects.filter(device=device).count()
                kill(broker)
                eventually(lambda: snapshot().get('health', {}).get('server_online') is False)
                eventually(lambda: snapshot().get('outbox_count', 0) > 0, seconds=20)
                broker = launch('broker', broker_args)
                eventually(lambda: snapshot().get('health', {}).get('server_synced'), seconds=60)
                eventually(lambda: RuntimeEvent.objects.filter(device=device).count() > old_count)
                kill(simulation)
                eventually(lambda: snapshot().get('health', {}).get('serial_groups', {}).get('1') is False)
                self.assertTrue(snapshot()['health']['serial_groups']['2'])
                launch('simulation-restart', simulation_args)
                eventually(lambda: snapshot().get('health', {}).get('serial_groups', {}).get('1') is True)
                kill(edge)
                kill(worker)
                launch('worker-restart', worker_args, env)
                launch('edge-restart', edge_args, edge_env)
                eventually(lambda: snapshot().get('health', {}).get('server_synced'), seconds=60)
                self.assertEqual((temp/'commands.txt').read_text().splitlines(), ['0|1|1'])
                self.assertEqual(Stock.objects.get(bin=bin_obj).quantity, 8)
            except Exception:
                for log in logs:
                    log.flush()
                for path in temp.glob('*.log'):
                    print(path.name, path.read_text(errors='replace')[-5000:])
                raise
            finally:
                for child in reversed(processes):
                    kill(child)
                for log in logs:
                    log.close()
