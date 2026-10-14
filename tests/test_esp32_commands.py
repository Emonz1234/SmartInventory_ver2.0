"""ESP32 wire and transport failure semantics; no physical hardware required."""
from unittest.mock import Mock, patch
import pytest
from ipc_core.adapters import HardwareAdapter, SimulationAdapter
from ipc_core.app.serial.serial_manager import SerialManager
from ipc_core.app.core.config import settings

@pytest.fixture
def hardware():
    with patch.object(settings, 'DEVICE_TYPE', 'IPC'), patch.object(settings, 'HARDWARE_ENABLED', True):
        link = SerialManager('COM9')
        link.serial = Mock(is_open=True)
        link.serial.write.side_effect = len
        link.observer = Mock()
        yield link

@pytest.mark.parametrize('action,terminal', [('OPEN','OPENED'),('CLOSE','CLOSED')])
def test_ack_is_not_completion_and_status_cannot_complete(hardware, action, terminal):
    link = hardware
    link.send_domain({'action':action,'address':2,'command_id':'op'})
    link.observe(link.adapter.parse(f'STATE 2 {terminal}'))
    assert 2 in link.pending
    link.observe(link.adapter.parse(f'ACK {action} 2'))
    assert 2 in link.pending
    limits = '1 0' if terminal == 'OPENED' else '0 1'
    status = link.adapter.parse(f'STATUS 2 {terminal} {limits} 100')
    link.observe(status)
    assert 2 in link.pending and 'hardware_command' not in status.payload
    endpoint = link.adapter.parse(f'STATE 2 {terminal}')
    link.observe(endpoint)
    assert 2 not in link.pending
    assert endpoint.payload['command_id'] == 'op'

@pytest.mark.parametrize('code',['OPEN_TIMEOUT','CLOSE_TIMEOUT','LIMIT_CONFLICT','SMOKE_ALARM','INVALID_COMMAND','INVALID_RACK'])
def test_error_finishes_pending_with_fault(hardware, code):
    hardware.send_domain({'action':'OPEN','address':1})
    hardware.observe(hardware.adapter.parse(f'ERROR 1 {code}'))
    assert not hardware.pending
    assert hardware.rack_states[1]['hardware_error'] == code

def test_command_timeout_sends_stop_and_never_claims_success(hardware):
    hardware.send_domain({'action':'OPEN','address':1,'command_id':'op'})
    with patch('ipc_core.app.serial.serial_manager.time.monotonic', return_value=hardware.pending[1][1]+9):
        hardware.poll()
    assert b'STOP 1\n' in [c.args[0] for c in hardware.serial.write.call_args_list]
    event = hardware.observer.call_args.args[0]
    assert event.payload['hardware_error'] == 'COMMUNICATION_ERROR'
    assert event.payload['command_id'] == 'op'
    assert not hardware.pending

def test_disconnect_fails_pending_and_reconnect_requests_status(hardware):
    hardware.send_domain({'action':'CLOSE','address':3,'command_id':'op'})
    hardware.disconnect()
    assert not hardware.pending
    assert hardware.observer.call_args.args[0].payload['hardware_error'] == 'COMMUNICATION_ERROR'
    with patch('ipc_core.app.serial.serial_manager.serial.serial_for_url', return_value=hardware.serial):
        hardware.connect()
    assert b'STATUS 3\n' in [c.args[0] for c in hardware.serial.write.call_args_list]

def test_stop_invalidates_original_command(hardware):
    hardware.send_domain({'action':'OPEN','address':1,'command_id':'open-op'})
    hardware.send_domain({'action':'STOP','address':1,'command_id':'stop-op'})
    assert hardware.observer.call_args.args[0].payload['command_id'] == 'open-op'
    hardware.observe(hardware.adapter.parse('ACK STOP 1'))
    hardware.observe(hardware.adapter.parse('STATE 1 STOPPED'))
    assert not hardware.pending

@pytest.mark.parametrize('frame',['ACK OPEN 0','STATE 1 BAD','STATUS 1 OPENED 0 1 100','STATUS 1 CLOSED 0 1 5000','STATE -1 CLOSED','ACK WHAT 1','STATUS 1 CLOSED 0 1 1 extra'])
def test_invalid_frames(frame):
    with pytest.raises(ValueError): HardwareAdapter().parse(frame)

@pytest.mark.parametrize('address',[0,-1,True,'1',65536])
def test_invalid_addresses(address):
    with pytest.raises(ValueError): HardwareAdapter().encode({'action':'OPEN','address':address})

def test_simulation_wire_format_is_preserved():
    assert SimulationAdapter().encode({'action':'OPEN','address':7}) == '0|7|1'

def test_partial_write_disconnects_and_never_completes(hardware):
    hardware.serial.write.side_effect = lambda data: len(data)-1
    with pytest.raises(IOError):
        hardware.send_domain({'action':'OPEN','address':1,'command_id':'op'})
    hardware.serial.close.assert_called_once()
    assert not hardware.pending
    assert hardware.observer.call_args.args[0].payload['hardware_error'] == 'COMMUNICATION_ERROR'
