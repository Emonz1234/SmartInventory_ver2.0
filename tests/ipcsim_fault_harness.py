"""JSON-lines bridge for browser recovery tests using the real Simulation/IPC state machines."""
import contextlib
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

from Simulation.virtual_serial.virtual_master_controller import MasterCom
from ipc_core.adapters import SimulationAdapter
from ipc_core.recovery_service import RecoveryService
from ipc_core.store import Store


class Harness:
    def __init__(self, directory):
        self.directory = directory
        self.number = 0
        self.reset()

    def reset(self):
        self.number += 1
        self.sim = MasterCom(0, port='')
        store = Store(Path(self.directory) / f'edge-{self.number}.db', 'browser-sim', 'IPCSIM')
        with store.transaction() as db:
            for address in range(1, 7):
                record = {'key': f'rack:{100+address}', 'kind': 'rack', 'data': {'id': 100+address, 'rack_code': str(address)}}
                db.execute('INSERT INTO edge_records VALUES(?,?,?)', ('browser-sim', record['key'], json.dumps(record)))
        serial = SimpleNamespace(connected=True, send=lambda raw: self.sim.determine_operationInformation(raw))
        self.edge = RecoveryService(store, serial)
        self.edge.poll()
        self.steps = []

    def state(self):
        self.sim.publish_state()
        while not self.sim.messages.empty():
            message = SimulationAdapter().parse(self.sim.messages.get_nowait())
            if message.msg_type == 'simulation_state':
                self.edge.receive(message.payload)
        return self.edge.states()[0]

    def advance(self, elapsed):
        for event in self.sim.step_operations(elapsed):
            if event['type'] == 'step_started':
                self.steps.append([event['rack_id'], event['direction']])

    def request(self, data):
        operation = data['operation']
        if operation == 'RESET':
            self.reset()
        elif operation == 'EXECUTE':
            self.edge.guard(data['address'])
            self.edge.send(1, 'EXECUTE', address=data['address'], action=data['action'], command_id=data['command_id'])
            self.advance(0)
        elif operation == 'INTERRUPT':
            # Finish R6, then interrupt R5 at 40% while logically opening R3.
            self.advance(0)
            self.advance(4)
            self.advance(0)
            self.advance(1.6)
            self.sim.set_errors(5, [1])
        elif operation == 'CLEAR':
            self.sim.set_errors(5, [])
        elif operation == 'FAULT_AGAIN':
            self.sim.set_errors(5, [1])
        elif operation == 'REFERENCE_LOST':
            self.sim.gap_controller.inject_fault(5, 'REFERENCE_LOST', 'REQUIRES_HOME', False)
        elif operation == 'STOP':
            self.edge.send(1, 'STOP', address=data['address'], error_code='OPERATOR_STOP')
        elif operation == 'RECOVER':
            self.edge.recover(1, data['action'], data['fault_id'], data['confirmed'])
            self.advance(0)
        elif operation == 'COMPLETE':
            for _ in range(100):
                self.advance(0)
                self.advance(4)
                if not self.sim.gap_controller.current_command and not self.sim.gap_controller.pending_commands:
                    break
        elif operation != 'STATE':
            raise ValueError('Unknown harness operation')
        return {'state': self.state(), 'steps': self.steps}


with tempfile.TemporaryDirectory(prefix='ipcsim-fault-') as directory:
    with contextlib.redirect_stdout(sys.stderr):
        harness = Harness(directory)
    for line in sys.stdin:
        try:
            with contextlib.redirect_stdout(sys.stderr):
                result = harness.request(json.loads(line))
            print(json.dumps(result), flush=True)
        except Exception as exc:
            print(json.dumps({'error': str(exc)}), flush=True)
