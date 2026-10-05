"""Real Qt event-loop regression tests; no physical COM ports or visible windows."""
import os
import time

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
import pytest

pytest.importorskip('PyQt6')
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QFontDatabase
from pathlib import Path
from Simulation.main import MainWindow
from ipc_core.adapters import SimulationAdapter
import serial
import threading


def until(app, predicate, timeout=4):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        app.processEvents()
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError('Qt condition timed out')


@pytest.fixture
def window(monkeypatch):
    for key in list(os.environ):
        if key.startswith('SIMULATION_SERIAL_PORT'):
            monkeypatch.delenv(key)
    app = QApplication.instance() or QApplication([])
    if not QFontDatabase.families():
        for name in ('segoeui.ttf', 'segoeuib.ttf', 'seguisym.ttf'):
            QFontDatabase.addApplicationFont(str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / name))
    win = MainWindow()
    yield app, win
    for worker in win.rack_group.values():
        worker.stop()
    until(app, lambda: all(not worker.isRunning() for worker in win.rack_group.values()))
    win.close()
    app.processEvents()


def test_buttons_initialize_all_groups_and_shutdown(window):
    app, win = window
    win.stop_master_controller(0)
    win.start_simulate_error(0)
    for index, group in enumerate(win.uic.rackGroupList):
        group.rackButtons[-1].click()
        group.runButton.click()
        assert set(win.environment_data[index]) == set(range(index * 6 + 1, index * 6 + 7))
        assert len(win.operation_data[index]) == len(win.breakdown_data[index]) == 6
    until(app, lambda: all(g.simulatorErrorButton.isEnabled() for g in win.uic.rackGroupList))
    assert all('Standalone' in g.connectionStatus.text() for g in win.uic.rackGroupList)
    worker = win.rack_group[0]
    win.start_master_controller(0)
    assert win.rack_group[0] is worker
    for group in win.uic.rackGroupList:
        assert group.displacement.value() == 0
        assert group.weight.value() > 0
        assert len(group.rackGroupImage.operations) == 6
        assert not group.rackGroupImage.grab().isNull()
    win.show()
    win.close()
    until(app, lambda: all(not t.isRunning() for t in win.rack_group.values()) and not win.isVisible())


def test_selected_rack_commands_fault_clear_stop_restart(window):
    app, win = window
    group = win.uic.rackGroupList[1]
    group.runButton.click()
    until(app, group.simulatorErrorButton.isEnabled)
    group.rackButtons[2].click()  # Rack 9, not the first rack in its group.
    group.simulatorErrorButton.click()  # Clearing when no fault exists is safe.
    group.ObstructCheckBox.setChecked(True)
    group.simulatorErrorButton.click()
    until(app, lambda: win.breakdown_data[1][9][0] == 1)
    assert 'Rack 9: Obstructed' in group.rackGroupErrorLineEdit.text()
    group.ObstructCheckBox.setChecked(False)
    group.simulatorErrorButton.click()
    until(app, lambda: win.breakdown_data[1][9] == [0, 0, 0])
    until(app, lambda: win.rack_group[1].master_controller.system_state == 'RECOVERING')
    win.resume_standalone(1)
    until(app, lambda: win.rack_group[1].master_controller.system_state == 'IDLE')
    until(app, group.localButtons[0].isEnabled)
    group.localButtons[0].click()
    until(app, lambda: win.rack_group[1].master_controller.opening_racks == [9])
    group.rackButtons[0].click()
    assert group.rackGroupErrorLineEdit.text() == ''
    assert not group.ObstructCheckBox.isChecked()
    group.rackButtons[2].click()
    assert not group.ObstructCheckBox.isChecked()
    until(app, lambda: group.displacement.value() > 0, timeout=20)
    assert win.operation_data[1][7][1] == 0
    group.stopButton.click()
    until(app, group.runButton.isEnabled)
    old = win.rack_group[1]
    group.runButton.click()
    until(app, group.simulatorErrorButton.isEnabled)
    assert win.rack_group[1] is not old
    assert group.displacement.value() == 0
    assert win.rack_group[1].master_controller.opening_racks == []
    assert group.rackGroupErrorLineEdit.text() == ''


def test_bad_port_recovers_buttons_and_can_retry(window):
    app, win = window
    group = win.uic.rackGroupList[0]
    group.serialPort.setEditText('not-a-real-port://')
    group.runButton.click()
    until(app, group.runButton.isEnabled)
    assert 'Serial error' in group.connectionStatus.text()
    assert group.connectionStatus.toolTip()
    assert not group.stopButton.isEnabled()
    assert not group.simulatorErrorButton.isEnabled()
    group.serialPort.setCurrentIndex(0)
    group.runButton.click()
    until(app, group.simulatorErrorButton.isEnabled)
    assert 'Standalone' in group.connectionStatus.text()


def test_immediate_stop_during_startup(window):
    app, win = window
    group = win.uic.rackGroupList[0]
    for _ in range(5):
        group.runButton.click()
        group.stopButton.click()
        until(app, group.runButton.isEnabled)
        assert not win.rack_group[0].isRunning()
        assert not group.simulatorErrorButton.isEnabled()


class SerialWire:
    """Inject IPC frames and capture controller output independently of the GUI."""
    def __init__(self):
        self.rx = bytearray()
        self.writes = []
        self.lock = threading.Lock()
        self.disconnected = False
        self.closed = False

    def inject(self, frame):
        with self.lock:
            self.rx.extend((frame + '\n').encode())

    @property
    def in_waiting(self):
        if self.disconnected:
            raise serial.SerialException('test cable disconnected')
        with self.lock:
            return len(self.rx)

    def read(self, count):
        with self.lock:
            data = bytes(self.rx[:count])
            del self.rx[:count]
            return data

    def write(self, raw):
        if self.disconnected:
            raise serial.SerialException('test cable disconnected')
        with self.lock:
            self.writes.append(raw.decode().strip())
        return len(raw)

    def close(self):
        self.closed = True


def test_connected_groups_route_every_rack_and_recover_disconnect(window, monkeypatch):
    app, win = window
    wires = {'TEST-A': SerialWire(), 'TEST-B': SerialWire()}
    monkeypatch.setattr(serial, 'serial_for_url', lambda port, **kwargs: wires[port])
    for index, name in enumerate(wires):
        group = win.uic.rackGroupList[index]
        group.serialPort.setEditText(name)
        group.runButton.click()
    until(app, lambda: all(win.uic.rackGroupList[i].simulatorErrorButton.isEnabled() for i in (0, 1)))
    for index, wire in enumerate(wires.values()):
        legacy = [f for f in wire.writes if not f.startswith('SIMSTT|')]
        assert len(legacy) == 18
        assert {int(f.split('|')[1]) for f in legacy} == set(range(index * 6 + 1, index * 6 + 7))
        assert not any(b.isEnabled() for b in win.uic.rackGroupList[index].localButtons)
    for address in (1, 2, 6):
        wires['TEST-A'].inject(SimulationAdapter().encode({'address': address, 'action': 'OPEN'}))
    wires['TEST-A'].inject('0|7|1')  # Must not leak into the other group.
    wires['TEST-B'].inject('0|12|3')
    until(app, lambda: win.rack_group[0].master_controller.gap_controller.current_step is not None
            and len(win.uic.rackGroupList[1].speedGraph.history.get(12, ())) >= 2)
    first_controller = win.rack_group[0].master_controller
    assert first_controller.current_gap == 6
    assert first_controller.gap_controller.current_step['rack_id'] == 6
    assert list(first_controller.gap_controller.pending_commands) == [(2, 1), (6, 1)]
    assert sum(rack.is_moving for rack in first_controller.gap_controller.racks.values()) == 1
    assert win.operation_data[1][7][1] == 0
    assert win.operation_data[0][3][1] == 0
    other = win.uic.rackGroupList[2]
    other.serialPort.setEditText('test-a')
    other.runButton.click()
    assert 'already used' in other.connectionStatus.text()
    assert 2 not in win.rack_group
    wires['TEST-A'].disconnected = True
    group = win.uic.rackGroupList[0]
    until(app, lambda: first_controller.system_state == 'ERROR')
    fault_position = first_controller.gap_controller.racks[6].position_mm
    assert wires['TEST-A'].closed
    assert win.rack_group[1].isRunning()
    wires['TEST-A'] = SerialWire()
    until(app, lambda: first_controller.ser is wires['TEST-A'])
    assert win.rack_group[0].master_controller is first_controller
    assert first_controller.gap_controller.racks[6].position_mm == fault_position
    assert first_controller.system_state == 'ERROR'
    import json
    wires['TEST-A'].inject(json.dumps({'protocol_version': 2, 'cabinet_index': 1, 'peer_session': 'test-edge', 'operation': 'REQUEST_STATE'}))
    until(app, lambda: first_controller.system_state == 'RECOVERING')
    assert first_controller.gap_controller.racks[6].position_mm == fault_position


def test_chart_history_isolated_and_retained_until_restart(window):
    app, win = window
    group = win.uic.rackGroupList[0]
    group.runButton.click()
    until(app, group.simulatorErrorButton.isEnabled)
    until(app, lambda: len(group.speedGraph.history) == 6)
    group.localButtons[0].click()
    until(app, lambda: win.operation_data[0][1][1] == 64, timeout=30)
    group.stopButton.click()
    until(app, group.runButton.isEnabled)
    before = {rack: list(values) for rack, values in group.speedGraph.history.items()}
    group.rackButtons[1].click()
    assert group.speedGraph.selected == 2
    group.rackGroupImage.rackClicked.emit(1)
    assert group.speedGraph.selected == 1
    win.uic.groupSelector.setCurrentRow(1)
    assert win.uic.rackGroupList[1].speedGraph.history == {}
    win.uic.groupSelector.setCurrentRow(0)
    for size in ((1920, 1080), (1280, 720), (800, 600)):
        win.resize(*size)
        app.processEvents()
    assert before == {rack: list(values) for rack, values in group.speedGraph.history.items()}
    frozen = group.speedGraph.time_range()
    group.speedGraph.refresh_visible()
    assert group.speedGraph.time_range() == frozen
    assert not group.speedGraph.refresh.isActive()
    assert any(speed > 0 for _, speed, _ in before[2])  # Rack 2 moves to open GAP 1.
    assert all(speed == 0 for _, speed, _ in before[1])  # Logical target stays physically still.
    group.runButton.click()
    assert group.speedGraph.history == {}
    until(app, lambda: len(group.speedGraph.history) == 6)
    assert len(group.speedGraph.history[1]) == 1
    assert group.speedGraph.history[1][0][0] < 1
    assert group.speedGraph.history[1][0][1:] == (0, 0)


def test_chart_irregular_timestamps_bounds_and_no_timer_samples(window):
    from Simulation.dashboard_widgets import OperationChart
    chart = OperationChart()
    chart.select_rack(7)
    for timestamp, speed, position in ((0, 0, 0), (.3, 4, 1), (2.8, 8, 9)):
        assert chart.add_sample(7, timestamp, speed, position)
    assert [v[0] for v in chart.history[7]] == [0, .3, 2.8]
    assert not chart.add_sample(7, float('nan'), 4, 1)
    assert not chart.add_sample(7, 3, float('inf'), 1)
    assert not chart.add_sample(7, 1, 4, 1)
    assert not chart.add_sample(7, 3, -1, 1)
    chart.refresh_visible()
    assert len(chart.history[7]) == 3
    for i in range(2000):
        chart.add_sample(8, i / 20, i % 15, i % 64)
    assert len(chart.history[8]) == chart.MAX_SAMPLES
    assert chart.time_range() == pytest.approx((39.95, 99.95))
    chart.add_sample(7, 130, 0, 64)
    assert list(chart.history[7]) == [(130, 0, 64)]
    assert chart.time_range() == (70, 130)


@pytest.mark.parametrize('size', [(1920, 1080), (1440, 900), (1280, 720), (1024, 768)])
def test_common_window_sizes_show_all_sections(window, size):
    app, win = window
    win.resize(*size)
    win.show()
    for _ in range(5):
        app.processEvents()
    area = win.uic.scrollArea
    assert area.horizontalScrollBar().maximum() == 0
    assert area.verticalScrollBar().maximum() == 0
    group = win.uic.rackGroupList[0]
    for widget in (group.rackGroupImage, group.serialPort, group.speedGraph, group.simulatorErrorButton):
        assert widget.isVisible()
        point = widget.mapTo(area.viewport(), widget.rect().bottomRight())
        assert area.viewport().rect().contains(point)


def test_small_window_scrolls_without_losing_controls(window):
    app, win = window
    win.resize(800, 600)
    win.show()
    for _ in range(5):
        app.processEvents()
    area = win.uic.scrollArea
    assert area.verticalScrollBar().maximum() > 0
    group = win.uic.rackGroupList[0]
    area.ensureWidgetVisible(group.simulatorErrorButton)
    app.processEvents()
    assert group.simulatorErrorButton.isVisible()
    assert area.viewport().rect().contains(group.simulatorErrorButton.mapTo(area.viewport(), group.simulatorErrorButton.rect().center()))


def test_light_and_binary_readings_fit_small_dashboard(window):
    app, win = window
    win.resize(1920, 1080)
    win.show()
    group = win.uic.rackGroupList[0]
    group.runButton.click()
    until(app, group.simulatorErrorButton.isEnabled)
    group.localButtons[3].click()
    until(app, lambda: group.light.value() == 1)
    assert group.light.reading.text() == 'ON'
    assert group.isHardLock.reading.text() == 'UNLOCKED'
    win.resize(1024, 768)
    for _ in range(5):
        app.processEvents()
    for widget in (group.light, group.isHardLock, group.smoke):
        assert widget.reading.fontMetrics().horizontalAdvance(widget.reading.text()) <= widget.reading.width()
    group.rackButtons[1].click()
    assert group.light.reading.text() == 'OFF'
    group.rackButtons[0].click()
    assert group.light.reading.text() == 'ON'


def test_physical_motion_details_show_mm_and_selected_rack(window):
    from Simulation.gap_controller import GapMovementController

    app, win = window
    simulation = GapMovementController(range(1, 7))
    simulation.enqueue(3, 1)
    for _ in range(30):
        simulation.advance(1)
    simulation.enqueue(4, 1)
    simulation.advance(0)
    simulation.advance(2.08)
    group = win.uic.rackGroupList[0]
    group.rackGroupImage.set_gap_state(simulation.snapshot())
    group.rackButtons[2].click()
    assert group.movementSpeed.value() == 25
    assert group.displacement.value() == pytest.approx(52)
    assert 'MOVING LEFT' in group.motionDetails.text()
    assert '300 → 200 mm' in group.motionDetails.text()
    assert 'Duration: 4.0 s' in group.motionDetails.text()
    assert 'Progress: 52%' in group.motionDetails.text()
    group.rackButtons[0].click()
    assert group.movementSpeed.value() == 0
    assert 'State: IDLE' in group.motionDetails.text()


def test_ventilation_light_and_close_controls_follow_group_state(window):
    app, win = window
    group = win.uic.rackGroupList[0]
    group.runButton.click()
    until(app, group.simulatorErrorButton.isEnabled)
    controller = win.rack_group[0].master_controller
    controller.gap_controller.speed_mm_s = 1000  # Speed up UI wiring test only.
    assert group.localButtons[0].isEnabled()
    assert not group.localButtons[1].isEnabled()
    group.localButtons[2].click()
    until(app, lambda: controller.system_state == 'VENTILATED')
    until(app, lambda: group.localButtons[1].text() == 'Close group')
    assert '5 gaps' in group.gapStateLineEdit.text()
    assert not group.localButtons[2].isEnabled()
    assert group.localButtons[0].isEnabled()
    assert 'VENTILATED' in group.motionDetails.text()
    win.resize(1024, 768)
    win.show()
    for _ in range(5):
        app.processEvents()
    assert win.uic.scrollArea.horizontalScrollBar().maximum() == 0
    group.localButtons[3].click()
    until(app, lambda: group.light.value() == 1)
    assert group.rackGroupImage.gap_state['lights'][1]
    until(app, lambda: group.localButtons[3].text() == 'Turn light off')
    assert group.localButtons[3].isEnabled()
    assert controller.system_state == 'VENTILATED'
    group.localButtons[1].click()
    until(app, lambda: controller.system_state == 'IDLE')
    until(app, lambda: group.localButtons[2].isEnabled())
    assert [r.position_mm for r in controller.gap_controller.racks.values()] == [0, 100, 200, 300, 400, 500]
    assert not group.localButtons[1].isEnabled()
    assert controller.lights[0]
