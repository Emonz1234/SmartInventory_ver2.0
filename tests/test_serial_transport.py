from unittest.mock import patch
import pytest
from ipc_core.app.serial.serial_manager import SerialManager
from ipc_core.app.core.config import settings


def test_fragmented_serial_frames_are_preserved():
    manager = SerialManager()
    chunks = iter([b'ENVSTT|1|2', b'', b'2|60|80|0\n'])
    manager._buffer = bytearray()
    manager.serial = type('Serial', (), {'read_until': lambda self, *a, **kw: next(chunks)})()
    assert manager.read() is None
    assert manager.read() is None
    assert manager.read() == 'ENVSTT|1|22|60|80|0'


def test_hardware_cannot_execute_until_implemented():
    manager = SerialManager()
    with patch.object(settings, 'DEVICE_TYPE', 'IPC'), patch.object(settings, 'HARDWARE_ENABLED', False):
        with pytest.raises(NotImplementedError):
            manager.connect()
        with pytest.raises(NotImplementedError):
            manager.send_domain({'action':'OPEN', 'address':1})


def test_group_serial_routes_without_rewriting_global_addresses():
    from ipc_core.app.serial.serial_manager import GroupSerialManager
    from unittest.mock import Mock
    manager = GroupSerialManager({1: 'first', 2: 'second'})
    manager.links = {1: Mock(connected=True), 2: Mock(connected=False)}
    manager.send_domain({'action': 'OPEN', 'address': 7})
    manager.links[2].send_domain.assert_called_once_with({'action': 'OPEN', 'address': 7})
    manager.links[1].send_domain.assert_not_called()
    assert manager.connected
    with pytest.raises(ConnectionError):
        manager.send_domain({'action': 'OPEN', 'address': 13})
