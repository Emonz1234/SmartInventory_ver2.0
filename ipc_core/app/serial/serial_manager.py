import serial
import threading
from ipc_core.adapters import adapter_for

from ..core.config import settings


class SerialManager:

    def __init__(self, port=None):

        self.serial = None
        self.lock = threading.Lock()
        self.adapter = adapter_for(settings.DEVICE_TYPE)
        self.observer = None
        self.port = settings.SERIAL_PORT if port is None else port

    @property
    def connected(self):
        return self.serial is not None and self.serial.is_open

    def send_domain(self, command):
        if settings.DEVICE_TYPE == "IPC" and not settings.HARDWARE_ENABLED:
            raise NotImplementedError("Hardware is not implemented; physical command execution is disabled")
        self.send(self.adapter.encode(command))

    def connect(self):

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

        print("Serial Connected")

    def disconnect(self):

        if self.serial:
            self.serial.close()

    def send(self, message: str):

        if not self.serial or not self.serial.is_open:
            raise ConnectionError("Serial connection not open")

        data = (message + "\n").encode("utf-8")
        with self.lock:
            if self.serial.write(data) != len(data):
                raise IOError("Partial Serial write; operation requires reconciliation")
            # write() is bounded by write_timeout. A flush() may block indefinitely
            # on some drivers; sent means queued to Serial, never hardware success.

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
