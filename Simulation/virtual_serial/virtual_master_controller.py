"""Six-rack simulator with one Serial owner and sequential GAP movement."""
import os
import random
import threading
import time
import json
import zlib
import base64
from uuid import uuid4
from queue import Queue, Empty

import serial
try:
    from Simulation.topology import GROUP_COUNT, RACKS_PER_GROUP
    from Simulation.gap_controller import GapMovementController, ACTION_NAMES, MOVE_DISTANCE_MM
except ImportError:
    from topology import GROUP_COUNT, RACKS_PER_GROUP
    from gap_controller import GapMovementController, ACTION_NAMES, MOVE_DISTANCE_MM

MAX_RACK_NUMBER = RACKS_PER_GROUP
RACK_MAX_DISPLACEMENT = 64.0
ENV_DATA_SEND_INTERVAL = 10
OPR_DATA_SEND_INTERVAL = 0.1


class MasterCom:
    def __init__(self, rack_group_id=0, port=None, baudrate=9600, timeout=0.05):
        if not 0 <= rack_group_id < GROUP_COUNT:
            raise ValueError(f'Group index must be between 0 and {GROUP_COUNT - 1}')
        self.rack_group_id = rack_group_id
        # Explicit empty port selects standalone; None loads environment configuration.
        self.port = (os.getenv(f'SIMULATION_SERIAL_PORT_{rack_group_id}') or
                     os.getenv('SIMULATION_SERIAL_PORT', '')) if port is None else port
        self.port = self.port.strip()
        self.baudrate, self.timeout = baudrate, timeout
        self.ser = None
        self.stop_event = threading.Event()
        self.requests, self.messages = Queue(), Queue()
        self.operation_samples = Queue()
        self.session_started = time.monotonic()
        self.boot_id = str(uuid4())
        self.snapshot_sequence = 0
        self.peer_session = None
        self.peer_seen = 0
        self.last_snapshot = 0
        self.last_wire_progress = 0
        self.known_commands = {}
        self.known_recovery_requests = set()
        self.reset_state()

    @property
    def rack_ids(self):
        return range(self.rack_group_id * MAX_RACK_NUMBER + 1,
                     (self.rack_group_id + 1) * MAX_RACK_NUMBER + 1)

    def reset_state(self):
        self.is_run = self.is_rack_operation = self.is_reading = False
        self.gap_controller = GapMovementController(self.rack_ids)
        self.gap_dirty = False
        self.error_racks = [[] for _ in self.rack_ids]
        self.ventilating_racks_status = [[0.0, 0] for _ in self.rack_ids]
        self.lights = [False for _ in self.rack_ids]
        self.ventilating_racks, self.opening_racks, self.closing_racks = [], [], []
        self.env_messages = [f'ENVSTT|{r}|20.0|40.0|80.0|0' for r in self.rack_ids]
        self.opr_messages = [f'OPRSTT|{r}|0.0|0.0|0|1|-1' for r in self.rack_ids]
        self.brk_messages = [f'BRKSTT|{r}|0|0|0' for r in self.rack_ids]
        self._rx = bytearray()
        self._discard_line = False
        for queue in (self.requests, self.messages, self.operation_samples):
            while True:
                try:
                    queue.get_nowait()
                except Empty:
                    break

    def start(self):
        if self.is_run:
            return
        self.reset_state()
        # Do not clear a stop requested while the QThread is starting.
        if self.stop_event.is_set():
            return
        self.session_started = time.monotonic()
        try:
            if self.port:
                self.ser = serial.serial_for_url(self.port, baudrate=self.baudrate,
                                                 timeout=self.timeout, write_timeout=2)
            self.is_run = True
            self.is_reading = self.ser is not None
            self.create_environmentStatusData()
            for message in self.opr_messages + self.brk_messages:
                self._publish(message)
            now = time.monotonic()
            self._next_env = now + ENV_DATA_SEND_INTERVAL
            self._next_operation = now + OPR_DATA_SEND_INTERVAL
            self._last_operation_update = now
        except Exception:
            self.execute_stopRunning()
            raise

    def _local_index(self, rack_id):
        if rack_id not in self.rack_ids:
            raise ValueError(f'Rack {rack_id} does not belong to group {self.rack_group_id + 1}')
        return rack_id - self.rack_group_id * MAX_RACK_NUMBER - 1

    def _cache(self, collection, message):
        collection[self._local_index(int(message.split('|')[1]))] = message
        return message

    def _publish(self, message):
        captured_at = time.monotonic() - self.session_started
        if self.ser is not None:
            try:
                data = (message + '\n').encode('utf-8')
                if self.ser.write(data) != len(data):
                    raise IOError('Partial simulation Serial write')
            except (OSError, serial.SerialException):
                # Preserve the mechanical controller even if the link disappears.
                self.ser.close()
                self.ser = None
                if self.gap_controller.current_command and self.gap_controller.system_state not in {'ERROR', 'RECOVERING', 'STOPPED'}:
                    self.gap_controller.inject_fault(self.gap_controller.current_command[0], 'COMMUNICATION_LOST')
        self.messages.put(message)
        if message.startswith('OPRSTT|'):
            index = self._local_index(int(message.split('|')[1]))
            self.operation_samples.put((message, captured_at, self.lights[index]))

    def create_environmentStatusData(self, rack_group_id=None):
        if rack_group_id is not None and rack_group_id != self.rack_group_id:
            raise ValueError('Cannot publish another group')
        for rack_id in self.rack_ids:
            value = random.random()
            message = (f'ENVSTT|{rack_id}|{20 + value * 2:.2f}|'
                       f'{40 + value * 40:.2f}|{80 - value * 1.8:.2f}|0')
            self._publish(self._cache(self.env_messages, message))

    @property
    def current_gap(self):
        return self.gap_controller.current_gap

    @property
    def active_rack(self):
        return self.gap_controller.active_rack

    @property
    def system_state(self):
        return self.gap_controller.system_state

    def _sync_legacy_activity(self):
        commands = []
        if self.gap_controller.current_command is not None:
            commands.append(self.gap_controller.current_command[:2])
        commands.extend(self.gap_controller.pending_commands)
        self.opening_racks = [rack_id for rack_id, action in commands if action == 1]
        self.closing_racks = [rack_id for rack_id, action in commands if action in (2, 4)]
        self.ventilating_racks = [rack_id for rack_id, action in commands if action == 3]
        self.is_rack_operation = bool(commands or self.gap_controller.current_step is not None)

    def _publish_operation(self, rack_id, speed, displacement, endpoint, state, direction=0):
        index = self._local_index(rack_id)
        self.ventilating_racks_status[index] = [float(displacement), direction]
        message = f'OPRSTT|{rack_id}|{float(speed)}|{float(displacement)}|0|{endpoint}|{state}'
        self._publish(self._cache(self.opr_messages, message))

    def _handle_gap_events(self, events):
        for event in events:
            kind = event['type']
            if kind == 'command_started':
                action_name = ACTION_NAMES[event['action']]
                if event['action'] in (1, 2, 3, 4):
                    state = 2 if event['action'] == 4 else event['action']
                    # Ventilation is one group command: report all participating
                    # racks as ventilating, including the stationary reference rack.
                    participants = self.rack_ids if event['action'] == 3 else [event['rack_id']]
                    for rack_id in participants:
                        position = self.ventilating_racks_status[self._local_index(rack_id)][0]
                        self._publish_operation(rack_id, 0, position, 0, state)
                print(f"[SIM] {action_name}_RACK started rack={event['rack_id']}")
                print(f"[SIM] current_gap={event['current_gap']} target_gap={event['target_gap']}")
            elif kind == 'step_started':
                state = 1 if event['direction'] == 'LEFT' else 2
                print(f"[SIM] Moving rack {event['rack_id']} {event['direction']}")
                self._publish_operation(event['rack_id'], 0, 0, 0, state,
                                        1 if event['direction'] == 'LEFT' else -1)
            elif kind == 'step_progress':
                if time.monotonic() - self.last_wire_progress < .2:
                    continue
                self.last_wire_progress = time.monotonic()
                state = 1 if event['direction'] == 'LEFT' else 2
                # Keep legacy IPC wire units at this boundary only; GUI uses mm snapshots.
                physical = self.gap_controller.racks[event['rack_id']]
                wire_scale = RACK_MAX_DISPLACEMENT / MOVE_DISTANCE_MM
                self._publish_operation(event['rack_id'], physical.speed_mm_s * wire_scale,
                                        event['progress'] * wire_scale, 0, state,
                                        1 if event['direction'] == 'LEFT' else -1)
                command = self.gap_controller.current_command
                if command and command[1] in (1, 2, 3, 4):
                    state = 2 if command[1] == 4 else command[1]
                    position = self.ventilating_racks_status[self._local_index(command[0])][0]
                    self._publish_operation(command[0], 0, position, 0, state)
            elif kind == 'step_completed':
                print(f"[SIM] Rack {event['rack_id']} completed; current_gap={event['current_gap']}")
                # A physical step ending is not the logical command endpoint.
                state = 1 if event['direction'] == 'LEFT' else 2
                self._publish_operation(event['rack_id'], 0, 0, 0, state)
            elif kind == 'command_completed':
                rack_id, action = event['rack_id'], event['action']
                if action in (0, 5):
                    self.lights[self._local_index(rack_id)] = action == 0
                    position = self.ventilating_racks_status[self._local_index(rack_id)][0]
                    self._publish_operation(rack_id, 0, position, 1, action)
                    continue
                # Movement endpoints define which rack is accessible. Keep lighting
                # unchanged during movement/faults, then light only the opened rack.
                self.lights[:] = [action == 1 and other_id == rack_id for other_id in self.rack_ids]
                displacement = RACK_MAX_DISPLACEMENT if action == 1 else 0.0
                for other_id in self.rack_ids:
                    if other_id == rack_id:
                        continue
                    previous = self.opr_messages[self._local_index(other_id)].split('|')
                    if float(previous[3]) != 0 or previous[5:] != ['1', '-1']:
                        self._publish_operation(other_id, 0, 0, 1, -1)
                self._publish_operation(rack_id, 0, displacement, 1, -1)
                print(f"[SIM] {ACTION_NAMES[action]}_RACK completed rack={rack_id} current_gap={event['current_gap']}")
            elif kind == 'movement_error':
                command_rack = event['command_rack_id'] or event['rack_id']
                previous = self.opr_messages[self._local_index(command_rack)].split('|')
                self._publish_operation(command_rack, 0, float(previous[3]), 0, -2)
                print(f"[SIM] MOVEMENT_ERROR rack={event['rack_id']} current_gap={event['current_gap']} reason={event['reason']}")
            elif kind == 'command_rejected':
                self._publish_operation(event['rack_id'], 0, 0, 1, -2)
                print(f"[SIM] Command rejected rack={event['rack_id']} reason={event['reason']}")
        self._sync_legacy_activity()
        self.gap_dirty = True
        if any(event['type'] != 'step_progress' for event in events):
            self.publish_state()

    def gap_snapshot(self):
        return {**self.gap_controller.snapshot(),
                'lights': dict(zip(self.rack_ids, self.lights)),
                'captured_at': time.monotonic() - self.session_started}

    def _complete_action(self, rack_id, action, command_id=None):
        index = self._local_index(rack_id)
        if (action in (1, 2) and self.error_racks[index]) or (action == 3 and any(self.error_racks)):
            self._publish_operation(rack_id, 0, 0, 1, -2)
            print(f'[SIM] Command rejected rack={rack_id}: active hardware breakdown')
            return False
        try:
            if command_id and command_id in self.known_commands:
                if self.known_commands[command_id] != (rack_id, action):
                    raise ValueError('Command identity collision')
                self.publish_state()
                return True
            queued = self.gap_controller.enqueue(rack_id, action, command_id)
            if command_id:
                self.known_commands[command_id] = (rack_id, action)
        except ValueError as exc:
            self._publish_operation(rack_id, 0, 0, 1, -2)
            print(f'[SIM] Command rejected rack={rack_id} action={action}: {exc}')
            return False
        if not queued:
            return True
        self._sync_legacy_activity()
        self.gap_dirty = True
        if action == 1:
            print(f'[SIM] OPEN_RACK requested rack={rack_id} current_gap={self.current_gap}')
        elif action == 4:
            print(f'[SIM] RETURN_HOME requested current_gap={self.current_gap}')
        return True

    def create_breakdownStatusData(self, error_numbers, rack_id):
        self._local_index(rack_id + 1)
        flags = '|'.join(str(int(n in error_numbers)) for n in (1, 2, 3))
        return self._cache(self.brk_messages, f'BRKSTT|{rack_id + 1}|{flags}')

    def set_errors(self, rack_id, error_numbers):
        index = self._local_index(rack_id)
        errors = sorted(set(error_numbers))
        if any(e not in (1, 2, 3) for e in errors):
            raise ValueError('Unknown fault')
        self.error_racks[index] = errors
        self._publish(self.create_breakdownStatusData(errors, rack_id - 1))
        if errors:
            parts = self.opr_messages[index].split('|')
            parts[2] = '0.0'
            self._publish(self._cache(self.opr_messages, '|'.join(parts)))
            if not self.gap_controller.fault_context or self.gap_controller.fault_context.get('cleared'):
                code = {1: 'OBSTRUCTED', 2: 'SKEWED', 3: 'MOTOR_OVERLOAD'}[errors[0]]
                event = self.gap_controller.inject_fault(rack_id, code)
                self._handle_gap_events([event])
        elif not any(self.error_racks) and self.gap_controller.system_state == 'ERROR':
            self.gap_controller.recover()
        self.gap_dirty = True
        self.publish_state('DEVICE_ERROR' if errors else 'ERROR_CLEARED')

    def publish_state(self, event='STATE_SNAPSHOT', request_id=None):
        self.snapshot_sequence += 1
        state = self.gap_snapshot()
        state['history'] = state['history'][-6:]
        if state.get('fault_context'):
            state['fault_context'] = {k: v for k, v in state['fault_context'].items() if k != 'racks'}
        state.update(cabinet_index=self.rack_group_id + 1, boot_id=self.boot_id,
                     sequence=self.snapshot_sequence, peer_session=self.peer_session,
                     request_id=request_id, event=event,
                     sensors={'position_trusted': (state.get('fault_context') or {}).get('position_trusted', True),
                              'faults': {rid: errors for rid, errors in zip(self.rack_ids, self.error_racks)}})
        # Compact extension fits low-baud links; legacy ENV/OPR/BRK stay unchanged.
        raw = json.dumps({'type': 'simulation_state', **state}, separators=(',', ':')).encode()
        self._publish('SIMSTT|' + base64.b64encode(zlib.compress(raw)).decode('ascii'))
        self.last_snapshot = time.monotonic()

    def control(self, data):
        """Versioned extension; old three-field commands remain supported."""
        if data.get('protocol_version') != 2 or data.get('cabinet_index') != self.rack_group_id + 1:
            return False
        session = data.get('peer_session')
        if not isinstance(session, str) or not session:
            return False
        operation = data.get('operation')
        if operation != 'REQUEST_STATE' and session != self.peer_session:
            return False
        self.peer_session, self.peer_seen = session, time.monotonic()
        try:
            if operation == 'REQUEST_STATE':
                context = self.gap_controller.fault_context
                if context and context['error_code'] == 'COMMUNICATION_LOST' and self.gap_controller.system_state == 'ERROR' and not any(self.error_racks):
                    self.gap_controller.recover()
                self.publish_state(request_id=data.get('request_id'))
                return True
            if operation == 'EXECUTE':
                action = {name: code for code, name in ACTION_NAMES.items()}[data['action']]
                return self._complete_action(int(data['address']), action, data['command_id'])
            if data.get('request_id') in self.known_recovery_requests:
                self.publish_state(request_id=data.get('request_id'))
                return True
            if operation == 'STOP':
                address = int(data['address'])
                self._local_index(address)
                if not self.gap_controller.fault_context:
                    self._handle_gap_events([self.gap_controller.inject_fault(address, data.get('error_code', 'OPERATOR_STOP'))])
                return True
            if any(self.error_racks):
                raise ValueError('Physical faults remain active')
            context = self.gap_controller.fault_context
            if not context or data.get('fault_id') != context['fault_id']:
                raise ValueError('Fault identity mismatch')
            if operation == 'RESUME':
                if self.gap_controller.system_state == 'ERROR' and context['error_code'] == 'COMMUNICATION_LOST':
                    self.gap_controller.recover()
                self.gap_controller.resume(data['fault_id'], data.get('confirmed') is True)
            elif operation == 'ABORT':
                self.gap_controller.abort(data['fault_id'])
            elif operation == 'HOME':
                self.gap_controller.home_recovery(data['fault_id'], data.get('confirmed') is True)
            else:
                raise ValueError('Unknown recovery action')
            self.gap_dirty = True
            self.known_recovery_requests.add(data.get('request_id'))
            self.publish_state('RECOVERY_STARTED', data.get('request_id'))
            return True
        except (KeyError, TypeError, ValueError) as exc:
            self.publish_state('CONTROL_REJECTED', data.get('request_id'))
            print(f'[SIM] Recovery rejected: {exc}')
            return False

    def determine_operationInformation(self, message):
        if message.lstrip().startswith('{'):
            try:
                return self.control(json.loads(message))
            except (ValueError, TypeError):
                return False
        parts = message.strip().split('|')
        if len(parts) != 3 or parts[0] != '0' or parts[2] not in ('0', '1', '2', '3', '4', '5'):
            return False
        try:
            rack_id = int(parts[1])
            self._local_index(rack_id)
        except ValueError:
            return False
        action = int(parts[2])
        if action == 4:
            rack_id = self.rack_ids[0]
        return self._complete_action(rack_id, action)

    def step_operations(self, elapsed=1.0, blocked_racks=None):
        blocked = ({rack_id for rack_id, faults in zip(self.rack_ids, self.error_racks) if any(faults)}
                   if blocked_racks is None else set(blocked_racks))
        events = self.gap_controller.advance(elapsed, blocked_racks=blocked)
        if events:
            self._handle_gap_events(events)
        return events

    def read_serial_once(self):
        if self.ser is None:
            return
        count = min(self.ser.in_waiting, 4096)
        if not count:
            return
        for byte in self.ser.read(count):
            if byte == 10:
                if not self._discard_line:
                    self.determine_operationInformation(self._rx.decode('utf-8', errors='replace'))
                self._rx.clear()
                self._discard_line = False
            elif not self._discard_line:
                self._rx.append(byte)
                if len(self._rx) > 8192:
                    self._rx.clear()
                    self._discard_line = True

    def poll(self, now=None):
        if not self.is_run or self.stop_event.is_set():
            return False
        if self.port and self.ser is None:
            try:
                self.ser = serial.serial_for_url(self.port, baudrate=self.baudrate,
                                                 timeout=self.timeout, write_timeout=2)
            except (OSError, serial.SerialException):
                pass
        try:
            self.read_serial_once()
        except (OSError, serial.SerialException):
            if self.ser:
                self.ser.close()
            self.ser = None
            if self.gap_controller.current_command and self.gap_controller.system_state not in {'ERROR', 'RECOVERING', 'STOPPED'}:
                self._handle_gap_events([self.gap_controller.inject_fault(self.gap_controller.current_command[0], 'COMMUNICATION_LOST')])
        if self.peer_session and time.monotonic() - self.peer_seen > 8 and self.gap_controller.current_command and self.gap_controller.system_state not in {'ERROR', 'RECOVERING', 'STOPPED'}:
            self._handle_gap_events([self.gap_controller.inject_fault(self.gap_controller.current_command[0], 'COMMUNICATION_LOST')])
        for _ in range(100):
            try:
                kind, args = self.requests.get_nowait()
            except Empty:
                break
            if kind == 'fault':
                self.set_errors(*args)
            elif kind == 'command':
                self.determine_operationInformation(*args)
            elif kind == 'inject_fault':
                self._handle_gap_events([self.gap_controller.inject_fault(*args)])
            elif kind == 'recover':
                if not any(self.error_racks):
                    self.gap_controller.recover()
                    self.publish_state('ERROR_CLEARED')
            elif kind == 'resume':
                context = self.gap_controller.fault_context
                if not self.port and context and not any(self.error_racks):
                    try:
                        self.gap_controller.resume(context['fault_id'], True)
                    except ValueError as exc:
                        print(f'[SIM] Resume rejected: {exc}')
                    self.gap_dirty = True
        now = time.monotonic() if now is None else now
        if now >= self._next_env:
            self.create_environmentStatusData()
            for frame in self.brk_messages:
                self._publish(frame)
            self._next_env = now + ENV_DATA_SEND_INTERVAL
        if now >= self._next_operation:
            elapsed = max(0.0, now - self._last_operation_update)
            self.step_operations(elapsed)
            self._last_operation_update = now
            self._next_operation = now + OPR_DATA_SEND_INTERVAL
        if time.monotonic() - self.last_snapshot >= 2:
            self.publish_state()
        changed = self.gap_dirty
        self.gap_dirty = False
        return changed

    def execute_stopRunning(self):
        self.stop_event.set()
        self.is_run = self.is_reading = self.is_rack_operation = False
        if self.ser is not None:
            try:
                self.ser.close()
            finally:
                self.ser = None
