import serial
import threading
import time
import logging
from ipc_core.adapters import adapter_for

from ..core.config import settings

log = logging.getLogger(__name__)
if not log.handlers:
    log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)
log.propagate = False


class SerialManager:

    def __init__(self, port=None):

        self.serial = None
        self.lock = threading.RLock()
        self.pending = {}
        self.acknowledged = set()
        self.rack_states = {}
        self.last_rx = time.monotonic()
        self.last_ping = 0
        self.adapter = adapter_for(settings.DEVICE_TYPE)
        self.observer = None
        self.port = settings.SERIAL_PORT if port is None else port

    @property
    def connected(self):
        return self.serial is not None and self.serial.is_open

    def send_domain(self, command):
        if settings.DEVICE_TYPE == "IPC" and not settings.HARDWARE_ENABLED:
            raise NotImplementedError("Hardware integration is disabled")
        message = self.adapter.encode(command)
        if settings.DEVICE_TYPE != 'IPC':
            return self.send(message)
        address, action = command.get('address'), command['action']
        with self.lock:
            if address in self.pending and action in {'OPEN', 'CLOSE'}:
                raise ValueError('Rack has a pending hardware command')
            if action in {'OPEN', 'CLOSE'} and self.rack_states.get(address, {}).get('hardware_state') == 'ERROR':
                raise ValueError('RESET rack before moving')
            previous = self.pending.get(address)
            if action in {'STOP', 'RESET'} and previous:
                self.notify_error(address, 'STOPPED')
            if action in {'OPEN', 'CLOSE', 'RESET', 'STOP'}:
                self.acknowledged.discard(address)
                self.pending[address] = (action, time.monotonic(), command.get('command_id'))
            try:
                self.send(message)
            except Exception:
                # A partial write may have caused a physical effect. Close the
                # link and require STATUS reconciliation before another command.
                self.disconnect()
                raise

    def connect(self):
        if not settings.SERIAL_ENABLED:
            raise ConnectionError('Serial disabled by configuration')
        print(
            f"Connecting serial: "
            f"{self.port} "
            f"@ {settings.SERIAL_BAUDRATE}"
        )

        if settings.DEVICE_TYPE == "IPC" and not settings.HARDWARE_ENABLED:
            raise NotImplementedError("Hardware integration is disabled")
        self.serial = serial.serial_for_url(
            self.port,
            baudrate=settings.SERIAL_BAUDRATE,
            timeout=0.2, write_timeout=1
        )
        self._buffer = bytearray()
        self.last_rx = time.monotonic()
        if settings.DEVICE_TYPE == 'IPC':
            self.send('PING')
            for address in self.configured_addresses():
                self.send(f'STATUS {address}')

        print("Serial Connected")

    def disconnect(self):

        if self.serial:
            try:
                self.serial.close()
            except Exception:
                logging.getLogger(__name__).exception('Serial close failed')
        if settings.DEVICE_TYPE == 'IPC':
            with self.lock:
                for address in list(self.pending):
                    self.notify_error(address, 'COMMUNICATION_ERROR')
                self.pending.clear()
                self.acknowledged.clear()

    def send(self, message: str):

        if not self.adapter.supports_commands:
            raise NotImplementedError("Current ESP32 firmware is telemetry-only")

        if not self.serial or not self.serial.is_open:
            raise ConnectionError("Serial connection not open")

        data = (message + "\n").encode("utf-8")
        if message != 'PING':
            log.info('TX -> %s', message)
        with self.lock:
            if self.serial.write(data) != len(data):
                raise IOError("Partial Serial write; operation requires reconciliation")
            # write() is bounded by write_timeout. A flush() may block indefinitely
            # on some drivers; sent means queued to Serial, never hardware success.

    def configured_addresses(self):
        addresses = set(self.rack_states) | set(self.pending)
        runtime = getattr(self.observer, '__self__', None)
        if runtime:
            import json
            with runtime.store.transaction() as db:
                for row in db.execute('SELECT body FROM edge_records'):
                    record = json.loads(row[0])
                    if record.get('kind') == 'rack':
                        addresses.add(int(record['data']['rack_code']))
        return sorted(addresses or {1})

    def notify_error(self, address, code):
        from .protocol.message import SerialMessage
        payload = {'rack_id': address, 'hardware_state': 'ERROR', 'hardware_error': code, 'is_obstructed': 1}
        pending = self.pending.get(address)
        if pending:
            payload['hardware_command'] = pending[0]
            payload['command_id'] = pending[2]
        self.rack_states[address] = payload
        if self.observer:
            self.observer(SerialMessage(msg_type='event', payload=payload))

    def observe(self, message):
        with self.lock:
            self.last_rx = time.monotonic()
            payload = message.payload
            address = payload.get('rack_id')
            if address and ('hardware_state' in payload or 'hardware_error' in payload):
                self.rack_states[address] = {**self.rack_states.get(address, {}), **payload}
                if payload.get('hardware_state') not in {None, 'ERROR'}:
                    self.rack_states[address].pop('hardware_error', None)
            pending = self.pending.get(address)
            if not pending:
                return
            action = pending[0]
            if message.msg_type == 'ack' and payload.get('command') == action:
                self.acknowledged.add(address)
            if payload.get('hardware_frame') == 'STATUS':
                return
            if not payload.get('hardware_error') and address not in self.acknowledged:
                return
            payload['hardware_command'] = action
            payload['command_id'] = pending[2]
            state = payload.get('hardware_state')
            if payload.get('hardware_error') or state == 'ERROR' or (action == 'OPEN' and state == 'OPENED') or (action == 'CLOSE' and state == 'CLOSED') or (action == 'STOP' and state == 'STOPPED') or (action == 'RESET' and state in {'OPENED','CLOSED','UNKNOWN'}):
                self.pending.pop(address, None)
                self.acknowledged.discard(address)

    def poll(self):
        if settings.DEVICE_TYPE != 'IPC':
            return
        with self.lock:
            now = time.monotonic()
            for address, (action, started, command_id) in list(self.pending.items()):
                if now - started > settings.SERIAL_COMMAND_TIMEOUT:
                    self.send(f'STOP {address}')
                    self.notify_error(address, 'COMMUNICATION_ERROR')
                    self.pending.pop(address, None)
            if now - self.last_rx > max(10, settings.SERIAL_COMMAND_TIMEOUT + 2):
                raise ConnectionError('ESP32 heartbeat timeout')
            if now - self.last_ping > 2:
                self.send('PING')
                # Also repeat STATUS: ESP32 may reset after the port opens.
                if not self.pending:
                    for address in self.configured_addresses():
                        self.send(f'STATUS {address}')
                self.last_ping = now

    def read(self):

        if not self.serial:
            return None

        # A timeout may split a Serial frame. Keep its prefix until the newline.
        chunk = self.serial.read_until(b"\n", size=4096)
        self._buffer.extend(chunk)
        if len(self._buffer) > 8192:
            self._buffer.clear()
            raise ValueError("Serial frame exceeds 8192 bytes")
        if not self._buffer.endswith(b"\n"):
            return None
        line = bytes(self._buffer)
        self._buffer.clear()
        return line.decode('utf-8').strip()


class GroupSerialManager:
    """Independent links to Simulation groups; global Serial addresses stay unchanged."""
    def __init__(self, ports):
        self.links = {group: SerialManager(port) for group, port in ports.items()}
        self.adapter = adapter_for('IPCSIM')
        self.observer = None

    @property
    def connected(self):
        return any(link.connected for link in self.links.values())

    def send_domain(self, command):
        from Simulation.topology import RACKS_PER_GROUP
        group = (int(command['address']) - 1) // RACKS_PER_GROUP + 1
        if group not in self.links:
            raise ConnectionError(f'Simulation group {group} has no configured Serial port')
        self.links[group].send_domain(command)

    def disconnect(self):
        for link in self.links.values():
            link.disconnect()
