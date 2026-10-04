import json
from unittest.mock import Mock, patch

import pytest

from ipc_core.adapters import HardwareAdapter
from ipc_core.app.core.config import settings
from ipc_core.app.serial.serial_manager import SerialManager


@pytest.mark.parametrize('gas,alert', [(0, False), (2000, False), (2001, True), (4095, True)])
def test_firmware_sample_maps_alarm_without_losing_adc(gas, alert):
    frame = dict(rack_id=1, temperature=28.5, humidity=65, gas=gas, gas_alert=alert)
    message = HardwareAdapter().parse(json.dumps(frame))
    assert message.msg_type == 'telemetry'
    assert message.payload == {**frame, 'smoke': int(alert)}
    assert 'weight' not in message.payload


@pytest.mark.parametrize('line', ['START SYSTEM', 'DHT ERROR'])
def test_diagnostics_do_not_become_sensor_samples(line):
    assert HardwareAdapter().parse(line).msg_type == 'diagnostic'


@pytest.mark.parametrize('frame', [
    '[]', '{"rack_id":true}', '{"rack_id":0}',
    '{"rack_id":1,"gas":4096}', '{"rack_id":1,"temperature":NaN}',
    '{"rack_id":1,"gas_alert":"false"}', '{"type":"ack","rack_id":1}',
])
def test_invalid_hardware_frames_are_rejected(frame):
    with pytest.raises(ValueError):
        HardwareAdapter().parse(frame)


def test_enabled_hardware_connects_at_firmware_baud_but_cannot_write():
    with patch.object(settings, 'DEVICE_TYPE', 'IPC'), patch.object(settings, 'HARDWARE_ENABLED', True), patch.object(settings, 'SERIAL_BAUDRATE', 115200):
        manager = SerialManager('COM9')
        with patch('ipc_core.app.serial.serial_manager.serial.serial_for_url') as connect:
            manager.connect()
            connect.assert_called_once_with('COM9', baudrate=115200, timeout=0.2, write_timeout=1)
        manager.serial = Mock(is_open=True)
        with pytest.raises(NotImplementedError):
            manager.send_domain({'address': 1, 'action': 'OPEN'})
        with pytest.raises(NotImplementedError):
            manager.send('anything')
        manager.serial.write.assert_not_called()
