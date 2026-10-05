import pytest

from Simulation.gap_controller import GapMovementController


def gap_for(rack):
    return max(1, rack - 1)


def controller():
    return GapMovementController(range(1, 7))


def run_commands(simulation, blocked=()):
    events = []
    for _ in range(1000):
        events.extend(simulation.advance(1.0, blocked_racks=blocked))
        if simulation.system_state == 'ERROR' or (
            simulation.current_command is None and not simulation.pending_commands
        ):
            return events
    raise AssertionError('Queued gap movement did not finish')


@pytest.mark.parametrize('target,movement_count', [(1, 5), (2, 5), (3, 4), (4, 3), (5, 2), (6, 1)])
def test_open_from_home_uses_only_required_rack_movements(target, movement_count):
    simulation = controller()
    simulation.enqueue(target, 1)

    events = run_commands(simulation)

    assert sum(event['type'] == 'step_completed' for event in events) == movement_count
    assert simulation.current_gap == gap_for(target)
    assert simulation.active_rack == target
    assert simulation.system_state == 'OPEN'


@pytest.mark.parametrize('source,target', [(1, 2), (2, 3), (3, 4), (4, 5), (5, 6),
                                             (6, 5), (5, 4), (4, 3), (3, 2), (2, 1)])
def test_adjacent_gap_changes_move_exactly_one_rack(source, target):
    simulation = controller()
    simulation.enqueue(source, 1)
    run_commands(simulation)

    simulation.enqueue(target, 1)
    events = run_commands(simulation)

    completed = [event for event in events if event['type'] == 'step_completed']
    assert len(completed) == abs(gap_for(target) - gap_for(source))
    if completed:
        assert completed[0]['rack_id'] == max(source, target) - 1
        assert completed[0]['direction'] == ('LEFT' if target > source else 'RIGHT')
    assert simulation.current_gap == gap_for(target)
    assert simulation.active_rack == target


@pytest.mark.parametrize('source,target', [(1, 6), (6, 1), (2, 5), (5, 2), (1, 4),
                                             (4, 2), (2, 6), (6, 3), (3, 5), (5, 1)])
def test_direct_gap_change_uses_distance_not_home_reset(source, target):
    simulation = controller()
    simulation.enqueue(source, 1)
    run_commands(simulation)
    before = simulation.current_gap

    simulation.enqueue(target, 1)
    events = run_commands(simulation)

    assert sum(event['type'] == 'step_completed' for event in events) == abs(gap_for(target) - before)
    assert simulation.current_gap == gap_for(target)


def test_opening_current_gap_is_success_without_movement():
    simulation = controller()
    simulation.enqueue(3, 1)
    run_commands(simulation)
    simulation.enqueue(3, 1)

    events = run_commands(simulation)

    assert not any(event['type'] == 'step_completed' for event in events)
    assert events[-1]['type'] == 'command_completed'
    assert simulation.current_gap == 2


@pytest.mark.parametrize('target', [1, 2, 3, 4, 5, 6])
def test_home_returns_gap_to_rack_six(target):
    simulation = controller()
    simulation.enqueue(target, 1)
    run_commands(simulation)
    simulation.enqueue(target, 4)

    events = run_commands(simulation)

    assert sum(event['type'] == 'step_completed' for event in events) == 6 - gap_for(target)
    assert simulation.current_gap == 6
    assert simulation.active_rack is None
    assert simulation.system_state == 'IDLE'


def test_new_open_waits_in_fifo_and_starts_from_completed_gap():
    simulation = controller()
    simulation.enqueue(1, 1)
    simulation.advance(0)
    simulation.advance(0)
    first_step = simulation.advance(4)
    simulation.enqueue(4, 1)
    assert simulation.snapshot()['pending_commands'] == [{'rack_id': 4, 'action': 'OPEN'}]

    events = run_commands(simulation)

    completed_gaps = [event['current_gap'] for event in first_step + events if event['type'] == 'step_completed']
    assert completed_gaps == [5, 4, 3, 2, 1, 2, 3]
    assert simulation.current_gap == 3


def test_movement_error_keeps_last_completed_gap_and_stops_queue():
    simulation = controller()
    simulation.enqueue(1, 1)
    simulation.enqueue(4, 1)
    simulation.advance(0)
    simulation.advance(0)
    simulation.advance(4)
    simulation.advance(0)

    events = simulation.advance(1, blocked_racks={5})

    error = next(event for event in events if event['type'] == 'movement_error')
    assert error['rack_id'] == 5
    assert simulation.current_gap == 5
    assert simulation.system_state == 'ERROR'
    assert not simulation.pending_commands
    assert simulation.snapshot()['racks'][5]['movement_state'] == 'ERROR'


@pytest.mark.parametrize('rack_id,action', [(0, 1), (7, 1), (None, 1), (True, 1), (1, 6), (1, 'OPEN')])
def test_invalid_serial_command_fields_are_rejected(rack_id, action):
    with pytest.raises(ValueError):
        controller().enqueue(rack_id, action)


def test_group_global_rack_ids_keep_local_gap_order():
    simulation = GapMovementController(range(7, 13))
    simulation.enqueue(9, 1)

    events = run_commands(simulation)

    assert [event['rack_id'] for event in events if event['type'] == 'step_completed'] == [12, 11, 10, 9]
    assert simulation.current_gap == 2


def test_fifo_preserves_repeat_open_after_intervening_close():
    simulation = controller()
    assert simulation.enqueue(3, 1)
    assert not simulation.enqueue(3, 1)
    simulation.advance(0)
    assert simulation.enqueue(3, 2)
    assert simulation.enqueue(3, 1)
    events = run_commands(simulation)
    assert [event['action'] for event in events if event['type'] == 'command_completed'] == [1, 2, 1]
    assert simulation.active_rack == 3


@pytest.mark.parametrize('source,target,racks,direction', [
    (2, 6, [2, 3, 4, 5], 'LEFT'), (6, 2, [5, 4, 3, 2], 'RIGHT'),
])
def test_multistep_paths_are_sequential_and_update_gap_immediately(source, target, racks, direction):
    simulation = controller()
    simulation.enqueue(source, 1)
    run_commands(simulation)
    simulation.enqueue(target, 1)
    completed = []
    for expected in racks:
        events = simulation.advance(0)
        assert events[-1]['type'] == 'step_started'
        assert events[-1]['rack_id'] == expected
        assert events[-1]['direction'] == direction
        before_gap = simulation.current_gap
        before = {rid: rack.position_mm for rid, rack in simulation.racks.items()}
        for tick in range(1, 5):
            events = simulation.advance(1)
            assert sum(r.is_moving for r in simulation.racks.values()) == (1 if tick < 4 else 0)
            delta = -25 * tick if direction == 'LEFT' else 25 * tick
            assert simulation.racks[expected].position_mm == before[expected] + delta
            assert all(r.position_mm == before[rid] for rid, r in simulation.racks.items() if rid != expected)
            assert simulation.current_gap == before_gap + ((1 if direction == 'LEFT' else -1) if tick == 4 else 0)
        completed.append(events[-1]['rack_id'])
        assert simulation.racks[expected].displacement_mm == 100
        assert simulation.racks[expected].movement_state == 'IDLE'
        assert simulation.racks[expected].slot * 100 == simulation.racks[expected].position_mm
    assert completed == racks
    simulation.advance(0)
    assert simulation.active_rack == target


@pytest.mark.parametrize('speed', [20, 25, 33])
def test_duration_is_distance_divided_by_speed_without_teleport(speed):
    simulation = GapMovementController(range(1, 7), speed_mm_s=speed)
    simulation.enqueue(6, 1)
    simulation.advance(0)
    rack = simulation.racks[6]
    assert rack.position_mm == 500 and rack.target_position_mm == 600
    assert rack.duration_s == pytest.approx(100 / speed)
    assert 3 <= rack.duration_s <= 5
    simulation.advance(rack.duration_s * .52)
    assert rack.position_mm == pytest.approx(552)
    assert rack.progress_percent == pytest.approx(52)
    assert rack.slot == 5 and simulation.current_gap == 6
    simulation.advance(rack.duration_s * .48 + 1e-9)
    assert rack.position_mm == 600 and rack.slot == 6
    assert rack.progress_percent == 100 and simulation.current_gap == 5
