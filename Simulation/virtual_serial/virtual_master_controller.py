"""Six-rack simulator with one Serial owner and independent rack states."""
import math
import os
import random
import threading
import time
from queue import Queue, Empty

import serial
try:
    from Simulation.topology import GROUP_COUNT, RACKS_PER_GROUP
except ImportError:
    from topology import GROUP_COUNT, RACKS_PER_GROUP

MAX_RACK_NUMBER = RACKS_PER_GROUP
MAX_TEMPERATURE, MIN_TEMPERATURE = 22, 20
MAX_HUMIDITY, MIN_HUMIDITY = 80, 40
RACK_MOVEMENT_SPEED = 4.0
RACK_MAX_MOVEMENT_SPEED = 15
RACK_WEIGHT = 80.0
RACK_MAX_DISPLACEMENT = 64.0
ENV_DATA_SEND_INTERVAL = 10
OPR_DATA_SEND_INTERVAL = 1
MASTER_CONTROLLER_IDLE_STATE = 'master_controller_idle_state'


class MasterCom:
    def __init__(self, rack_group_id=0, port=None, baudrate=9600, timeout=0.05):
        if not 0 <= rack_group_id < GROUP_COUNT:
            raise ValueError('Group index must be between 0 and 20')
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
        self.reset_state()

    @property
    def rack_ids(self):
        return range(self.rack_group_id * MAX_RACK_NUMBER + 1,
                     (self.rack_group_id + 1) * MAX_RACK_NUMBER + 1)

    def reset_state(self):
        self.is_run = self.is_rack_operation = self.is_error = self.is_reading = False
        self.state = MASTER_CONTROLLER_IDLE_STATE
        self.rack_group_state = -1  # Diagnostic compatibility; never drives individual racks.
        self.current_keys = []
        self.error_racks = [[] for _ in self.rack_ids]
        self.ventilating_racks_status = [[0.0, 0] for _ in self.rack_ids]
        self.rack_states = [-1 for _ in self.rack_ids]
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
                                                 timeout=self.timeout, write_timeout=0.5)
            self.is_run = True
            self.is_reading = self.ser is not None
            self.create_environmentStatusData()
            for message in self.opr_messages + self.brk_messages:
                self._publish(message)
            now = time.monotonic()
            self._next_env = now + ENV_DATA_SEND_INTERVAL
            self._next_operation = now + OPR_DATA_SEND_INTERVAL
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
            self.ser.write((message + '\n').encode('utf-8'))
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

    def create_movement_speed_number(self, rack_id, random_parameter, settling_time=1.5):
        position = self.ventilating_racks_status[self._local_index(rack_id + 1)][0]
        proportional = RACK_MAX_MOVEMENT_SPEED / settling_time
        if position <= 3.2:
            base = proportional / 3
        elif position < 15:
            base = proportional * 0.4 + 0.6 * RACK_MAX_MOVEMENT_SPEED
        elif position < 47:
            base = RACK_MAX_MOVEMENT_SPEED
        elif position < 59.4:
            base = RACK_MAX_MOVEMENT_SPEED - proportional * 0.25
        else:
            base = RACK_MAX_MOVEMENT_SPEED - proportional
        return round(random_parameter * math.pow(-0.4, round(random_parameter * 10)) + base, 2)

    def _motion(self, rack_id, action):
        # Public generators retain the original zero-based global rack index.
        index = self._local_index(rack_id + 1)
        position, direction = self.ventilating_racks_status[index]
        speed = self.create_movement_speed_number(rack_id, random.random())
        endpoint, state = 0, action
        if self.error_racks[index]:
            speed = 0.0
        else:
            closing = action == 2 or (action == 3 and direction == 1)
            position = round(max(0.0, min(RACK_MAX_DISPLACEMENT,
                                        position + (-speed if closing else speed))), 2)
            if action == 3 and not closing and position >= RACK_MAX_DISPLACEMENT:
                direction = 1
            elif (closing and position <= 0) or (action == 1 and position >= RACK_MAX_DISPLACEMENT):
                speed, endpoint, state, direction = 0.0, 1, -1, 0
                for active in (self.opening_racks, self.closing_racks, self.ventilating_racks):
                    if rack_id + 1 in active:
                        active.remove(rack_id + 1)
        self.ventilating_racks_status[index] = [position, direction]
        self.rack_states[index] = state
        self.is_rack_operation = bool(self.opening_racks or self.closing_racks or self.ventilating_racks)
        return self._cache(self.opr_messages,
                           f'OPRSTT|{rack_id + 1}|{speed}|{position}|0|{endpoint}|{state}')

    def create_operation_ventilateStatusData(self, rack_id):
        return self._motion(rack_id, 3)

    def create_operation_open_rack_statusData(self, rack_id):
        return self._motion(rack_id, 1)

    def create_operation_close_rack_statusData(self, rack_id):
        return self._motion(rack_id, 2)

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
        self.is_error = any(self.error_racks)
        self._publish(self.create_breakdownStatusData(errors, rack_id - 1))
        if errors:
            parts = self.opr_messages[index].split('|')
            parts[2] = '0.0'
            self._publish(self._cache(self.opr_messages, '|'.join(parts)))

    def determine_operationInformation(self, message):
        parts = message.strip().split('|')
        if len(parts) != 3 or parts[0] != '0' or parts[2] not in ('0', '1', '2', '3'):
            return False
        try:
            rack_id = int(parts[1])
            index = self._local_index(rack_id)
        except ValueError:
            return False
        action = int(parts[2])
        if action == 0:
            self.lights[index] = True
            if self.rack_states[index] == -1:
                position = self.ventilating_racks_status[index][0]
                self._publish(self._cache(self.opr_messages, f'OPRSTT|{rack_id}|0.0|{position}|0|1|0'))
            return True
        target = {1: self.opening_racks, 2: self.closing_racks, 3: self.ventilating_racks}[action]
        if rack_id in target:
            return True
        # A conflicting command cannot replace an unfinished physical movement.
        if any(rack_id in active for active in (self.opening_racks, self.closing_racks, self.ventilating_racks)):
            return False
        target.append(rack_id)
        self.ventilating_racks_status[index][1] = 0
        self.rack_states[index] = action
        self.is_rack_operation = True
        return True

    def step_operations(self):
        for active, generate in ((self.opening_racks, self.create_operation_open_rack_statusData),
                                 (self.closing_racks, self.create_operation_close_rack_statusData),
                                 (self.ventilating_racks, self.create_operation_ventilateStatusData)):
            for rack_id in list(active):
                self._publish(generate(rack_id - 1))

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
                if len(self._rx) > 256:
                    self._rx.clear()
                    self._discard_line = True

    def poll(self, now=None):
        if not self.is_run or self.stop_event.is_set():
            return
        self.read_serial_once()
        for _ in range(100):
            try:
                kind, args = self.requests.get_nowait()
            except Empty:
                break
            if kind == 'fault':
                self.set_errors(*args)
            elif kind == 'command':
                self.determine_operationInformation(*args)
        now = time.monotonic() if now is None else now
        if now >= self._next_env:
            self.create_environmentStatusData()
            for frame in self.brk_messages:
                self._publish(frame)
            self._next_env = now + ENV_DATA_SEND_INTERVAL
        if now >= self._next_operation:
            self.step_operations()
            self._next_operation = now + OPR_DATA_SEND_INTERVAL

    def execute_stopRunning(self):
        self.stop_event.set()
        self.is_run = self.is_reading = self.is_rack_operation = self.is_error = False
        if self.ser is not None:
            try:
                self.ser.close()
            finally:
                self.ser = None
