"""Real TCP MQTT integration, opt in with MQTT_INTEGRATION=1."""
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
from django.test import TransactionTestCase
from django.contrib.auth import get_user_model
from sqlalchemy import create_engine
from ipc_core.app.database.database import Base
from ipc_core.app.database.models import inventory, environment, runtime as runtime_models, auth, system
from ipc_core.runtime import Runtime
from Server.inventory.models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Outbox
from Server.inventory.services import assign, create_operation, confirm_operation, refresh
from Server.inventory.mqtt import run_worker


def eventually(predicate, seconds=35):
    deadline = time.monotonic()+seconds
    while time.monotonic()<deadline:
        if predicate():
            return
        time.sleep(.2)
    raise AssertionError("Timed out waiting for MQTT state")


@skipUnless(os.environ.get("MQTT_INTEGRATION") == "1", "Set MQTT_INTEGRATION=1 and install test broker")
class BrokerIntegration(TransactionTestCase):
    def test_three_devices_sync_command_duplicate_and_reconnect(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1",0))
            port = s.getsockname()[1]
        root = Path(__file__).resolve().parents[2]
        broker = subprocess.Popen(["node",str(root/"tests/mqtt_broker.cjs"),str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        self.assertEqual(broker.stdout.readline().decode().strip(), "READY")
        stop = threading.Event()
        edges = []
        worker = None
        try:
            with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
                "MQTT_HOST":"127.0.0.1","MQTT_PORT":str(port),"MQTT_TLS":"0",
                "MQTT_USERNAME":"inventory-server","MQTT_PASSWORD":"test-broker-password"}):
                user = get_user_model().objects.create_superuser("test", "", "test-password")
                item = Item.objects.create(code="part",name="part",unit="piece")
                for i, kind in enumerate(["IPC","IPCSIM","IPCSIM"]):
                    device = Device.objects.create(device_id=f"edge-{i}",device_type=kind,name=kind)
                    cabinet = Cabinet.objects.create(code=f"C{i}",name="cabinet",domain=kind)
                    rack = Rack.objects.create(cabinet=cabinet,address=7+i)
                    shelf = Shelf.objects.create(rack=rack,code="shelf")
                    bin_obj = Bin.objects.create(shelf=shelf,code="bin")
                    Stock.objects.create(item=item,bin=bin_obj,quantity=10)
                    assign(cabinet.pk,device.pk)
                    path = Path(directory)/f"edge-{i}.db"
                    engine = create_engine(f"sqlite:///{path}")
                    Base.metadata.create_all(engine)
                    engine.dispose()
                    writes = []
                    serial = SimpleNamespace(connected=True,send_domain=writes.append)
                    cfg = SimpleNamespace(DB_PATH=str(path),DEVICE_ID=device.pk,DEVICE_TYPE=kind,
                        MQTT_HOST="127.0.0.1",MQTT_PORT=port,MQTT_PASSWORD="test-broker-password",MQTT_TLS=False)
                    edge = Runtime(cfg,serial)
                    edges.append((edge,device,rack,bin_obj,writes))
                worker = threading.Thread(target=run_worker,args=(stop,),daemon=True)
                worker.start()
                for edge,*_ in edges:
                    edge.start()
                def ready():
                    return all(e.online and e.store.revision()>0 for e,*_ in edges) and not Device.objects.filter(acknowledged_revision=0).exists()
                eventually(ready)
                for edge,device,rack,bin_obj,writes in edges:
                    self.assertEqual([r["data"]["id"] for r in edge.store.records() if r["kind"]=="rack"],[rack.pk])
                edge,device,rack,bin_obj,writes = edges[1]
                op = create_operation(user,dict(device_id=device.pk,rack_id=rack.pk,item_id=item.pk,bin_id=bin_obj.pk,kind="PICK",quantity=2,request_key="mqtt-operation"))
                eventually(lambda:Operation.objects.get(pk=op.pk).state=="sent")
                self.assertEqual(len(writes),1)
                # Simulate lost application ACK: replay exactly the same command from durable outbox.
                Outbox.objects.filter(channel="command",device=device).update(acknowledged=False,sent_at=None)
                eventually(lambda: not Outbox.objects.filter(channel="command",device=device,acknowledged=False).exists())
                self.assertEqual(len(writes),1)
                confirm_operation(user,op.pk,"Two pieces counted by operator")
                eventually(lambda:edge.store.revision()==Device.objects.get(pk=device.pk).revision)
                def finalized():
                    with edge.store.transaction() as db:
                        return db.execute("SELECT state FROM edge_operations WHERE id=?", (str(op.pk),)).fetchone()[0] == "confirmed"
                eventually(finalized)
                Outbox.objects.filter(device=device,body__message_type="command.execute").update(acknowledged=False,sent_at=None)
                eventually(lambda:not Outbox.objects.filter(device=device,body__message_type="command.execute",acknowledged=False).exists())
                self.assertEqual(len(writes),1)
                self.assertEqual(Stock.objects.get(bin=edges[0][3]).quantity,10)
                self.assertEqual(Stock.objects.get(bin=bin_obj).quantity,8)
                edge.client.disconnect()
                eventually(lambda:not edge.connected)
                edge.record_serial(SimpleNamespace(msg_type="telemetry",payload={"rack_id":rack.address,"temperature":23}))
                edge.client.reconnect()
                edge.client.loop_start()
                eventually(lambda:edge.online)
                from Server.inventory.models import RuntimeEvent
                eventually(lambda:RuntimeEvent.objects.filter(device=device).exists())
                self.assertEqual(len(writes),1)
                # Disconnect MQTT, complete local PUT/PICK, restart IPC and replay over real TCP.
                edge.client.disconnect()
                eventually(lambda:not edge.connected)
                for index, (kind, quantity) in enumerate([('PUT', 3), ('PICK', 2)]):
                    tx = edge.transactions.start(user.pk, dict(kind=kind, quantity=quantity,
                        item_id=item.pk, bin_id=bin_obj.pk, rack_id=rack.pk, request_key=f'local-offline-{index}'))
                    for state, position, endpoint in [(1, 1, 0), (-1, 20, 1)]:
                        edge.transactions.observe({'rack_id':rack.address,'state':state,'displacement':position,'is_endpoint':endpoint})
                    edge.transactions.confirm(user.pk, tx['transaction_id'], True, 'Physical count verified')
                    for state, position, endpoint in [(2, 1, 0), (-1, 0, 1)]:
                        edge.transactions.observe({'rack_id':rack.address,'state':state,'displacement':position,'is_endpoint':endpoint})
                self.assertEqual(edge.sync.repo.state()['pending_transactions'], 2)
                edge.stop()
                replacement = Runtime(edge.settings, edge.serial)
                edges[1] = (replacement,device,rack,bin_obj,writes)
                edge = replacement
                edge.start()
                eventually(lambda:edge.sync.repo.state()['pending_transactions']==0, seconds=60)
                eventually(lambda:edge.store.revision()==Device.objects.get(pk=device.pk).revision)
                self.assertEqual(Stock.objects.get(bin=bin_obj).quantity, 9)
                with edge.store.transaction() as db:
                    self.assertEqual(db.execute('SELECT quantity FROM item_locations WHERE item_id=? AND bin_id=?', (item.pk,bin_obj.pk)).fetchone()[0], 9)
                for edge,*_ in edges:
                    edge.stop()
                stop.set()
                worker.join(timeout=10)
        finally:
            for edge,*_ in edges:
                edge.stop()
            stop.set()
            if worker:
                worker.join(timeout=10)
            broker.terminate()
            broker.wait(timeout=5)
