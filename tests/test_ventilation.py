import pytest

from Simulation.gap_controller import GapMovementController
from Simulation.virtual_serial.virtual_master_controller import MasterCom
from ipc_core.adapters import SimulationAdapter


def finish(controller):
    events = []
    for _ in range(500):
        before = {rid: rack.position_mm for rid, rack in controller.racks.items()}
        events.extend(controller.advance(.2))
        positions = [rack.position_mm for rack in controller.racks.values()]
        assert all(b - a >= 100 - 1e-8 for a, b in zip(positions, positions[1:]))
        assert sum(rack.is_moving for rack in controller.racks.values()) <= 1
        assert sum(abs(rack.position_mm - before[rid]) > 1e-8 for rid, rack in controller.racks.items()) <= 1
        assert all(abs(rack.position_mm - before[rid]) <= 5 + 1e-8 for rid, rack in controller.racks.items())
        if not controller.current_command and not controller.pending_commands:
            return events
    raise AssertionError('Movement did not finish')


@pytest.mark.parametrize('source', range(7))
@pytest.mark.parametrize('destination', range(8))
def test_ventilate_evenly_from_every_layout_and_leave_without_collision(source, destination):
    sim = GapMovementController(range(1, 7))
    if source:
        sim.enqueue(source, 1)
        finish(sim)
    sim.enqueue(3, 3)
    finish(sim)
    assert [r.position_mm for r in sim.racks.values()] == [0, 120, 240, 360, 480, 600]
    assert sim.current_gap is None and sim.active_rack is None
    assert sim.system_state == 'VENTILATED'
    assert all(r['access_state'] == 'VENTILATED' for r in sim.snapshot()['racks'].values())
    sim.enqueue(2, 3)
    assert not any(e['type'] == 'step_started' for e in finish(sim))
    if destination == 0:
        sim.enqueue(2, 4)
        target_gap = 6
    elif destination == 7:
        sim.enqueue(2, 2)
        target_gap = 6
    else:
        sim.enqueue(destination, 1)
        target_gap = max(1, destination - 1)
    finish(sim)
    assert sim.current_gap == target_gap
    assert [r.position_mm for r in sim.racks.values()] == [
        (order - 1 + (order > target_gap)) * 100 for order in range(1, 7)]


def test_fault_during_ventilation_stops_all_motion_and_clears_queue():
    sim = GapMovementController(range(1, 7))
    sim.enqueue(1, 3)
    sim.enqueue(2, 1)
    sim.advance(0)
    sim.advance(1)
    positions = [r.position_mm for r in sim.racks.values()]
    sim.advance(.2, blocked_racks={1})  # Fault in a stationary rack also stops ventilation.
    assert sim.system_state == 'ERROR'
    assert not any(r.is_moving for r in sim.racks.values())
    assert not sim.pending_commands
    sim.advance(10)
    assert [r.position_mm for r in sim.racks.values()] == positions


def test_serial_fanout_ventilates_group_once_and_light_preserves_layout():
    master = MasterCom(1, port='')
    for rack in range(7, 13):
        assert master.determine_operationInformation(f'0|{rack}|3')
    events = []
    for _ in range(150):
        events.extend(master.step_operations(.2))
    assert sum(e['type'] == 'step_completed' for e in events) == 5
    assert master.system_state == 'VENTILATED'
    payloads = [SimulationAdapter().parse(master.messages.get_nowait()).payload
                for _ in range(master.messages.qsize())]
    for rack in range(7, 13):
        rows = [row for row in payloads if row.get('rack_id') == rack]
        start = next(i for i, row in enumerate(rows) if row['state'] == 3 and not row['is_endpoint'])
        assert any(row['state'] == -1 and row['is_endpoint'] for row in rows[start + 1:])
    positions = [r.position_mm for r in master.gap_controller.racks.values()]
    assert master.determine_operationInformation('0|9|0')
    master.step_operations(0)
    assert master.system_state == 'VENTILATED'
    assert master.gap_snapshot()['lights'][9]
    assert [r.position_mm for r in master.gap_controller.racks.values()] == positions


def test_ventilation_rejects_fault_in_any_rack_before_moving():
    master = MasterCom(0, port='')
    master.set_errors(6, [1])
    assert not master.determine_operationInformation('0|1|3')
    assert not master.gap_controller.pending_commands
