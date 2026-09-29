from Simulation.virtual_serial.virtual_master_controller import MasterCom
from ipc_core.adapters import SimulationAdapter
import pytest
import serial


def run_to_idle(controller):
    events = []
    for _ in range(200):
        events.extend(controller.step_operations(0))
        if controller.gap_controller.current_step is not None:
            events.extend(controller.step_operations(1))
        if controller.gap_controller.current_command is None and not controller.gap_controller.pending_commands:
            return events
    raise AssertionError('Queued rack operations did not finish')


def test_actual_simulator_accepts_adapter_commands_and_emits_shared_model():
    controller = MasterCom(rack_group_id=1, port='')
    controller.start()
    adapter = SimulationAdapter()
    controller.determine_operationInformation(adapter.encode({"address": 7, "action": "OPEN"}))
    assert controller.opening_racks == [7]
    open_events = run_to_idle(controller)
    assert [event['rack_id'] for event in open_events if event['type'] == 'step_completed'] == [12, 11, 10, 9, 8]
    opened = adapter.parse(controller.opr_messages[controller._local_index(7)]).payload
    assert opened['rack_id'] == 7 and opened['is_endpoint'] == 1
    assert opened['state'] == -1 and opened['displacement'] == 64

    controller.determine_operationInformation(adapter.encode({"address":7,"action":"CLOSE"}))
    close_events = run_to_idle(controller)
    assert [event['rack_id'] for event in close_events if event['type'] == 'step_completed'] == [8]
    closed = adapter.parse(controller.opr_messages[controller._local_index(7)]).payload
    assert closed['is_endpoint'] == 1 and closed['state'] == -1
    assert closed['displacement'] == 0 and controller.current_gap == 2
    controller.execute_stopRunning()


def test_simulator_environment_and_breakdown_are_normalized():
    controller = MasterCom(rack_group_id=0, port="test-only")
    writes = []
    controller.ser = type("SerialCapture", (), {"write":lambda self, raw:writes.append(raw)})()
    controller.create_environmentStatusData(0)
    assert len(writes) == 6
    assert all(SimulationAdapter().parse(raw.decode()).msg_type == "telemetry" for raw in writes)
    fault = controller.create_breakdownStatusData([1,3], 0)
    parsed = SimulationAdapter().parse(fault)
    assert parsed.payload["is_obstructed"] == 1
    assert parsed.payload["is_overload_motor"] == 1


@pytest.mark.parametrize('group', range(21))
def test_start_initializes_all_six_racks_without_serial(group):
    controller = MasterCom(group, port='')
    controller.start()
    try:
        assert controller.is_run and not controller.is_reading
        assert controller.messages.qsize() == 18
        for frames in (controller.env_messages, controller.opr_messages, controller.brk_messages):
            assert {int(frame.split('|')[1]) for frame in frames} == set(controller.rack_ids)
            assert all(SimulationAdapter().parse(frame) for frame in frames)
        assert controller.ventilating_racks_status == [[0.0, 0]] * 6
        assert controller.error_racks == [[]] * 6
        controller.start()  # No duplicate initialization while running.
        assert controller.messages.qsize() == 18
    finally:
        controller.execute_stopRunning()
        controller.execute_stopRunning()


def test_environment_and_breakdown_publish_at_configured_interval():
    from Simulation.virtual_serial.virtual_master_controller import ENV_DATA_SEND_INTERVAL

    controller = MasterCom(rack_group_id=0, port='')
    controller.start()
    try:
        assert ENV_DATA_SEND_INTERVAL == 10
        due = controller._next_env
        controller._next_operation = due + 1000
        while not controller.messages.empty():
            controller.messages.get_nowait()

        controller.poll(now=due - 0.1)
        assert controller.messages.empty()

        controller.poll(now=due)
        assert controller.messages.qsize() == 12
        assert controller._next_env == due + ENV_DATA_SEND_INTERVAL
        assert controller._next_operation == due + 1000
    finally:
        controller.execute_stopRunning()


def test_multirack_motion_fault_clear_and_ventilation_cycle():
    c = MasterCom(1, port='')
    c.start()
    try:
        for command in ('0|7|1', '0|8|1', '0|9|3'):
            assert c.determine_operationInformation(command)
        assert c.determine_operationInformation('0|9|3')  # Adjacent retry is idempotent.
        assert c.opening_racks == [7, 8]
        assert not any(rack.is_moving for rack in c.gap_controller.racks.values())
        events = run_to_idle(c)
        assert len([event for event in events if event['type'] == 'command_completed']) == 3
        assert c.current_gap is None and c.active_rack is None
        assert c.system_state == 'VENTILATED'
        assert c.ventilating_racks == []
        assert not c.is_rack_operation
        c.set_errors(7, [1, 3])
        assert c.error_racks[0] == [1, 3]
        c.set_errors(7, [])
        assert c.brk_messages[0] == 'BRKSTT|7|0|0|0'
    finally:
        c.execute_stopRunning()


@pytest.mark.parametrize('message', ['0|0|1', '0|7|1', '0|-1|1', '0|x|1', '1|1|1',
                                      '0|1|5', '0|1|10', '0|1|1|2', '', '0|1'])
def test_reject_malformed_or_wrong_group_commands(message):
    c = MasterCom(0, port='')
    assert not c.determine_operationInformation(message)
    assert not c.is_rack_operation


def test_real_pyserial_loopback_frames_and_partial_commands():
    c = MasterCom(2, port='loop://')
    c.start()
    try:
        c.read_serial_once()  # Its own telemetry is not interpreted as commands.
        assert not c.is_rack_operation
        c.ser.write(b'0|13|')
        c.read_serial_once()
        assert not c.is_rack_operation
        c.ser.write(b'1\r\n0|14|3\n0|1|1\n')
        c.read_serial_once()
        assert c.opening_racks == [13] and c.ventilating_racks == [14]
        c.ser.write(b'x' * 300 + b'0|15|1\n0|16|1\n')
        c.read_serial_once()
        assert c.opening_racks == [13, 16]
        c.step_operations(0)
        raw = c.ser.read(c.ser.in_waiting).decode().splitlines()
        moving = [SimulationAdapter().parse(frame).payload for frame in raw if frame.startswith('OPRSTT|')]
        assert [(row['rack_id'], row['state']) for row in moving] == [(13, 1), (18, 2)]
        assert sum(rack.is_moving for rack in c.gap_controller.racks.values()) == 1
    finally:
        c.execute_stopRunning()


def test_invalid_serial_fails_cleanly_without_falling_back():
    c = MasterCom(0, port='not-a-real-port://')
    with pytest.raises((ValueError, serial.SerialException)):
        c.start()
    assert not c.is_run and c.ser is None


def test_environment_port_resolution(monkeypatch):
    monkeypatch.setenv('SIMULATION_SERIAL_PORT', 'COM_GLOBAL')
    monkeypatch.setenv('SIMULATION_SERIAL_PORT_1', 'COM_GROUP')
    assert MasterCom(0).port == 'COM_GLOBAL'
    assert MasterCom(1).port == 'COM_GROUP'
    assert MasterCom(1, port='').port == ''


def test_fault_and_light_do_not_destroy_pending_motion():
    c = MasterCom(0, port='')
    c.start()
    assert c.determine_operationInformation('0|1|1')
    c.step_operations(0)
    assert c.gap_controller.current_step['rack_id'] == 6
    assert c.determine_operationInformation('0|1|0')
    assert c.opening_racks == [1] and not c.lights[0]
    assert list(c.gap_controller.pending_commands) == [(1, 0)]
    run_to_idle(c)
    assert c.current_gap == 1 and c.active_rack == 1
    assert c.lights[0]
    c.execute_stopRunning()


def test_chart_metadata_uses_acquisition_time_without_changing_serial(monkeypatch):
    import Simulation.virtual_serial.virtual_master_controller as module
    now = [100.0]
    monkeypatch.setattr(module.time, 'monotonic', lambda: now[0])
    c = MasterCom(0, port='')
    c.start()
    try:
        samples = [c.operation_samples.get_nowait() for _ in range(6)]
        assert all(s[1] == 0 for s in samples)
        now[0] = 102.75
        c.determine_operationInformation('0|1|0')
        c.step_operations(0)
        frame, timestamp, light = c.operation_samples.get_nowait()
        assert timestamp == 2.75 and light is True
        assert frame == 'OPRSTT|1|0.0|0.0|0|1|0'
        assert SimulationAdapter().parse(frame).payload['state'] == 0
    finally:
        c.execute_stopRunning()
