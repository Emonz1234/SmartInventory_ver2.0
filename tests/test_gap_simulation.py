import pytest

from Simulation.virtual_serial.virtual_master_controller import MasterCom
from ipc_core.adapters import SimulationAdapter


def run_to_idle(controller, blocked=()):
    events = []
    for _ in range(200):
        events.extend(controller.step_operations(0, blocked_racks=blocked))
        if controller.gap_controller.current_step is not None:
            events.extend(controller.step_operations(1, blocked_racks=blocked))
        if controller.gap_controller.current_command is None and not controller.gap_controller.pending_commands:
            return events
        if controller.system_state == 'ERROR':
            return events
    raise AssertionError('Simulation command did not finish')


def frames(controller):
    results = []
    while not controller.messages.empty():
        results.append(controller.messages.get_nowait())
    return results


def test_serial_open_uses_gap_path_and_reports_success_after_final_step():
    controller = MasterCom(0, port='')
    controller.start()
    try:
        frames(controller)
        assert controller.determine_operationInformation('0|3|1')
        assert controller.current_gap == 6

        events = run_to_idle(controller)

        completed_steps = [event for event in events if event['type'] == 'step_completed']
        assert [(event['rack_id'], event['direction'], event['current_gap']) for event in completed_steps] == [
            (6, 'RIGHT', 5), (5, 'RIGHT', 4), (4, 'RIGHT', 3), (3, 'RIGHT', 2)
        ]
        assert controller.active_rack == 3
        assert controller.system_state == 'OPEN'
        operation_frames = [SimulationAdapter().parse(frame).payload for frame in frames(controller) if frame.startswith('OPRSTT|')]
        final = [event for event in operation_frames if event['rack_id'] == 3 and event['is_endpoint']]
        assert final[-1]['state'] == -1 and final[-1]['displacement'] == 64
        assert controller.current_gap == 2
    finally:
        controller.execute_stopRunning()


def test_direct_open_transition_moves_one_rack_without_home():
    controller = MasterCom(0, port='')
    controller.start()
    try:
        controller.determine_operationInformation('0|3|1')
        run_to_idle(controller)
        assert controller.determine_operationInformation('0|4|1')
        events = run_to_idle(controller)
        steps = [event for event in events if event['type'] == 'step_completed']
        assert [(event['rack_id'], event['direction'], event['current_gap']) for event in steps] == [(3, 'LEFT', 3)]
        assert controller.current_gap == 3
        assert controller.active_rack == 4
    finally:
        controller.execute_stopRunning()


def test_return_home_is_explicit_and_closes_active_rack():
    controller = MasterCom(0, port='')
    controller.start()
    try:
        controller.determine_operationInformation('0|1|1')
        run_to_idle(controller)
        assert controller.current_gap == 1
        assert controller.determine_operationInformation('0|1|4')

        events = run_to_idle(controller)

        assert [event['current_gap'] for event in events if event['type'] == 'step_completed'] == [2, 3, 4, 5, 6]
        assert controller.current_gap == 6
        assert controller.active_rack is None
        assert controller.system_state == 'IDLE'
    finally:
        controller.execute_stopRunning()


def test_fault_stops_sequence_at_last_completed_gap():
    controller = MasterCom(0, port='')
    controller.start()
    try:
        frames(controller)
        controller.determine_operationInformation('0|1|1')
        events = []
        for _ in range(10):
            events.extend(controller.step_operations(0))
            if controller.current_gap == 5:
                break
            if controller.gap_controller.current_step is not None:
                events.extend(controller.step_operations(1))
        assert controller.current_gap == 5
        events.extend(controller.step_operations(1, blocked_racks={5}))
        assert controller.current_gap == 5
        assert controller.system_state == 'ERROR'
        assert any(event['type'] == 'movement_error' and event['rack_id'] == 5 for event in events)
        payloads = [SimulationAdapter().parse(frame).payload for frame in frames(controller) if frame.startswith('OPRSTT|')]
        assert not any(row['rack_id'] == 1 and row['is_endpoint'] and row['state'] == -1 for row in payloads)
    finally:
        controller.execute_stopRunning()


def test_invalid_wire_commands_are_rejected_without_changing_gap():
    controller = MasterCom(0, port='')
    for frame in ('0|0|1', '0|7|1', '0|-1|1', '0|x|1', '0|1|5', '1|1|1', '0|1'):
        assert not controller.determine_operationInformation(frame)
    assert controller.current_gap == 6
    assert controller.system_state == 'IDLE'


@pytest.mark.parametrize('rack_id,action', [(1, 1), (6, 1), (1, 2), (6, 2), (6, 3)])
def test_command_telemetry_has_fresh_start_before_final_endpoint(rack_id, action):
    controller = MasterCom(0, port='')
    if action == 2:
        controller.determine_operationInformation(f'0|{rack_id}|1')
        run_to_idle(controller)
    frames(controller)
    controller.determine_operationInformation(f'0|{rack_id}|{action}')
    events = run_to_idle(controller)
    payloads = [SimulationAdapter().parse(frame).payload for frame in frames(controller)]
    target = [row for row in payloads if row['rack_id'] == rack_id]
    assert target[0]['state'] == action and target[0]['is_endpoint'] == 0
    assert target[-1]['state'] == -1 and target[-1]['is_endpoint'] == 1
    assert target[-1]['displacement'] == (64 if action == 1 else 0)
    assert events[-1]['type'] == 'command_completed'


def test_switching_access_then_home_clears_previous_open_telemetry():
    controller = MasterCom(0, port='')
    for rack_id in (1, 4):
        controller.determine_operationInformation(f'0|{rack_id}|1')
        run_to_idle(controller)
    assert SimulationAdapter().parse(controller.opr_messages[0]).payload['displacement'] == 0
    assert SimulationAdapter().parse(controller.opr_messages[3]).payload['displacement'] == 64
    controller.determine_operationInformation('0|1|4')
    run_to_idle(controller)
    assert all(SimulationAdapter().parse(frame).payload['displacement'] == 0
               for frame in controller.opr_messages)
