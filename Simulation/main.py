from PyQt6 import QtCore
from PyQt6.QtWidgets import QApplication, QMainWindow
from PyQt6.QtCore import pyqtSignal
try:
    from .simulation_scroll import Ui_MainWindow
    from .virtual_serial.virtual_master_controller import MasterCom, MAX_RACK_NUMBER
    from .topology import GROUP_COUNT
except ImportError:
    from simulation_scroll import Ui_MainWindow
    from virtual_serial.virtual_master_controller import MasterCom, MAX_RACK_NUMBER
    from topology import GROUP_COUNT
from queue import Empty
from serial.tools import list_ports
from functools import partial
import sys
import math

# =======================================================
# LỚP CHÍNH
# =======================================================
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.uic = Ui_MainWindow(1, 10, 0)
        self.uic.setupUi(self)
        self.rack_group = {}
        self.environment_data = {}
        self.operation_data = {}
        self.breakdown_data = {}
        self.light_data = {}
        available_ports = list(list_ports.comports())

        # Kết nối các nút bấm với hàm xử lý
        for i in range(GROUP_COUNT):
            self.breakdown_data[i] = {}
            group = self.uic.rackGroupList[i]
            self.light_data[i] = {}
            group.stopButton.setEnabled(False)
            group.simulatorErrorButton.setEnabled(False)
            group.serialPort.addItem('Standalone (no IPC connection)', '')
            for port in available_ports:
                group.serialPort.addItem(port.device, port.device)
            configured = MasterCom(i).port
            if configured:
                group.serialPort.setEditText(configured)
            group.serialPort.setToolTip('Simulation end of a virtual COM pair; IPCSIM uses the other end.')
            for button, action in zip(group.localButtons, (1, 2, 3, 0)):
                button.setEnabled(False)
                button.setToolTip('Standalone commands; connected mode receives commands from IPCSIM.')
                button.clicked.connect(partial(self.send_local_command, i, action))
            group.rackGroupImage.rackClicked.connect(partial(self.select_visual_rack, i))
            group.speedGraph.select_rack(group.selected_rack_id)
            self.environment_data[i] = {}
            self.operation_data[i] = {}
            self.uic.rackGroupList[i].runButton.clicked.connect(partial(self.start_master_controller, i))
            self.uic.rackGroupList[i].stopButton.clicked.connect(partial(self.stop_master_controller, i))
            self.uic.rackGroupList[i].simulatorErrorButton.clicked.connect(partial(self.start_simulate_error, i))
            self.uic.rackGroupList[i].homeButton.clicked.connect(partial(self.send_local_command, i, 4))
            for rack_button in self.uic.rackGroupList[i].rackButtons:
                rack_button.clicked.connect(partial(self.select_rack, i, rack_button))

    # Khởi động một luồng điều khiển mới cho mỗi GROUP
    # [index] tương ứng [rack_group_id] trong file 'virtual_master_controller.py'
    def start_master_controller(self, index):
        previous = self.rack_group.get(index)
        if previous is not None and previous.isRunning():
            return
        group = self.uic.rackGroupList[index]
        port = group.serialPort.currentText().strip()
        if port == 'Standalone (no IPC connection)':
            port = ''
        if port and any(t.isRunning() and t.master_controller.port.casefold() == port.casefold()
                        for key, t in self.rack_group.items() if key != index):
            group.connectionStatus.setText(f'Port {port} is already used by another group')
            return
        worker = ThreadClass(index=index, port=port)
        self.rack_group[index] = worker
        self.environment_data[index].clear()
        self.operation_data[index].clear()
        self.breakdown_data[index].clear()
        self.light_data[index].clear()
        group.speedGraph.reset_session()
        group.rackGroupImage.operations.clear()
        group.rackGroupImage.faults.clear()
        # Initialize every rack before starting, including a previously selected rack.
        for message in worker.master_controller.env_messages:
            rack_id, *values = self.handle_environment_status(message)
            self.environment_data[index][rack_id] = values
        for message in worker.master_controller.opr_messages:
            rack_id, *values = self.handle_operation_status(message)
            self.operation_data[index][rack_id] = values
            group.rackGroupImage.set_rack(rack_id, operation=values)
        for rack_id in worker.master_controller.rack_ids:
            self.breakdown_data[index][rack_id] = (0, 0, 0)
            self.light_data[index][rack_id] = False
        group.rackGroupImage.set_gap_state(worker.master_controller.gap_snapshot())
        group.gapStateLineEdit.setText('CURRENT GAP 6  /  IDLE')
        group.rackGroupStateLineEdit.setText('HOME  /  READY')
        self.display_selected_rack(index)
        for checkbox in (group.ObstructCheckBox, group.SkewCheckBox, group.OverloadMotorCheckBox):
            checkbox.setChecked(False)
        worker.env_signal.connect(self.display_environment_status)
        worker.operation_sample.connect(self.display_operation_status)
        worker.brk_signal.connect(self.display_breakdown_status)
        worker.gap_signal.connect(self.display_gap_state)
        worker.ready.connect(self.controller_ready)
        worker.failed.connect(self.controller_failed)
        worker.finished.connect(self.controller_finished)
        group.connectionStatus.setText('Starting...')
        self.uic.set_group_status(index, 'active', 'STARTING')
        group.runButton.setEnabled(False)
        group.stopButton.setEnabled(True)
        group.serialPort.setEnabled(False)
        worker.start()

    def controller_ready(self, status):
        worker = self.sender()
        if self.rack_group.get(worker.index) is not worker or worker.master_controller.stop_event.is_set():
            return
        group = self.uic.rackGroupList[worker.index]
        group.connectionStatus.setText(status)
        group.connectionStatus.setToolTip(status)
        group.speedGraph.start_session(worker.master_controller.session_started)
        self.uic.set_group_status(worker.index, 'normal', 'RUNNING')
        group.simulatorErrorButton.setEnabled(True)
        group.homeButton.setEnabled(not worker.master_controller.port)
        for button in group.localButtons:
            button.setEnabled(not worker.master_controller.port)
        self.update_operation_controls(worker.index)

    def controller_failed(self, message):
        worker = self.sender()
        if self.rack_group.get(worker.index) is worker:
            group = self.uic.rackGroupList[worker.index]
            group.connectionStatus.setText('Serial error - see details')
            group.connectionStatus.setToolTip(message)
            group.speedGraph.stop_session()
            group.homeButton.setEnabled(False)
            self.uic.set_group_status(worker.index, 'error', 'SERIAL ERROR')

    def controller_finished(self):
        worker = self.sender()
        if self.rack_group.get(worker.index) is not worker:
            return
        group = self.uic.rackGroupList[worker.index]
        group.runButton.setEnabled(True)
        group.stopButton.setEnabled(False)
        group.serialPort.setEnabled(True)
        group.simulatorErrorButton.setEnabled(False)
        group.homeButton.setEnabled(False)
        for button in group.localButtons:
            button.setEnabled(False)
        if not worker.failure:
            group.connectionStatus.setText('Stopped')
        group.rackGroupStateLineEdit.setText('Stopped')
        group.speedGraph.stop_session()
        if not worker.failure:
            self.uic.set_group_status(worker.index, 'muted', 'STOPPED')

    def send_local_command(self, index, action):
        worker = self.rack_group.get(index)
        if worker and worker.isRunning() and worker.master_controller.is_run and not worker.master_controller.port:
            rack_id = self.uic.rackGroupList[index].selected_rack_id
            if action == 0 and self.light_data[index].get(rack_id, False):
                action = 5
            worker.master_controller.requests.put(('command', (f'0|{rack_id}|{action}',)))

    def select_visual_rack(self, group_index, rack_id):
        group = self.uic.rackGroupList[group_index]
        self.select_rack(group_index, group.rackButtons[rack_id - group_index * MAX_RACK_NUMBER - 1])

    def select_rack(self, group_index, selected_button):
        rack_group = self.uic.rackGroupList[group_index]
        rack_group.selected_rack_id = int(selected_button.text())
        rack_group.rackGroupImage.select(rack_group.selected_rack_id)
        rack_group.speedGraph.select_rack(rack_group.selected_rack_id)
        for rack_button in rack_group.rackButtons:
            rack_button.setChecked(rack_button is selected_button)
        self.display_selected_rack(group_index)
        errors = self.breakdown_data[group_index].get(rack_group.selected_rack_id, (0, 0, 0))
        for checkbox, flag in zip((rack_group.ObstructCheckBox, rack_group.SkewCheckBox,
                                   rack_group.OverloadMotorCheckBox), errors):
            checkbox.setChecked(bool(flag))

    # Dừng hoạt động
    def stop_master_controller(self, index):
        worker = self.rack_group.get(index)
        if worker is not None and worker.isRunning():
            worker.stop()
            group = self.uic.rackGroupList[index]
            group.connectionStatus.setText('Stopping...')
            group.speedGraph.stop_session()
            self.uic.set_group_status(index, 'muted', 'STOPPING')
            group.stopButton.setEnabled(False)
            group.simulatorErrorButton.setEnabled(False)
            group.homeButton.setEnabled(False)
            for button in group.localButtons:
                button.setEnabled(False)

    def start_simulate_error(self, index):
        worker = self.rack_group.get(index)
        if worker is None or not worker.isRunning() or not worker.master_controller.is_run:
            return
        group = self.uic.rackGroupList[index]
        errors = [n for n, box in enumerate((group.ObstructCheckBox, group.SkewCheckBox,
                                            group.OverloadMotorCheckBox), 1) if box.isChecked()]
        worker.master_controller.requests.put(('fault', (group.selected_rack_id, errors)))

    def closeEvent(self, event):
        for worker in self.rack_group.values():
            worker.stop()
        # Never destroy a live QThread; retry closing after cooperative shutdown.
        if any(worker.isRunning() for worker in self.rack_group.values()):
            event.ignore()
            QtCore.QTimer.singleShot(50, self.close)
        else:
            event.accept()

    def handle_environment_status(self, message):
        env_list = message.split('|')
        rack_id = int(env_list[1])
        temperature, humidity, weight, smoke = float(env_list[2]), float(env_list[3]), float(env_list[4]), int(env_list[5])
        return rack_id, temperature, humidity, weight, smoke

    def handle_operation_status(self, message):
        opr_list = message.split('|')
        rack_id, movement_speed, displacement, is_hard_locked, is_endpoint, rack_group_state = int(opr_list[1]), float(opr_list[2]), float(opr_list[3]), int(opr_list[4]), int(opr_list[5]), int(opr_list[6])
        return rack_id, movement_speed, displacement, is_hard_locked, is_endpoint, rack_group_state

    def handle_breakdown_status(self, message):
        brk_list = message.split('|')
        rack_id, is_obstructed, is_skewed, is_overload_motor = int(brk_list[1]), int(brk_list[2]), int(brk_list[3]), int(brk_list[4])
        return rack_id, is_obstructed, is_skewed, is_overload_motor

    # Hiển thị trạng thái vận hành mỗi GROUP
    def display_rack_group_state(self, rack_id, rack_group_id, rack_group_state):
        group = self.uic.rackGroupList[rack_group_id]
        worker = self.rack_group.get(rack_group_id)
        running = worker and worker.isRunning() and not worker.master_controller.stop_event.is_set()
        snapshot = group.rackGroupImage.gap_state or {}
        physical = snapshot.get('racks', {}).get(rack_id, {})
        state = physical.get('access_state', 'CLOSED')
        if snapshot.get('system_state') == 'VENTILATING':
            state = 'VENTILATING GROUP'
        elif physical.get('is_moving'):
            state = physical['movement_state'].replace('_', ' ')
        if any(self.breakdown_data[rack_group_id].get(rack_id, ())):
            state = 'Fault - movement paused'
        light = 'LIGHT ON' if self.light_data[rack_group_id].get(rack_id, False) else 'LIGHT OFF'
        group.rackGroupStateLineEdit.setText(f'Rack {rack_id:02d} / {state} / {light}' + ('' if running else ' / Stopped'))

    def update_operation_controls(self, index):
        group = self.uic.rackGroupList[index]
        worker = self.rack_group.get(index)
        state = group.rackGroupImage.gap_state or {}
        ready = bool(worker and worker.isRunning() and worker.master_controller.is_run
                     and not worker.master_controller.port and not worker.master_controller.stop_event.is_set())
        busy = bool(state.get('current_command') or state.get('pending_commands'))
        healthy = state.get('system_state') != 'ERROR' and not any(any(v) for v in self.breakdown_data[index].values())
        available = ready and not busy and healthy
        ventilated = state.get('system_state') == 'VENTILATED'
        active = state.get('active_rack') == group.selected_rack_id
        rack_id = group.selected_rack_id
        physical = state.get('racks', {}).get(rack_id, {})
        rack_status = physical.get('access_state', 'CLOSED').replace('_', ' ').title()
        if any(self.breakdown_data[index].get(rack_id, ())):
            rack_status = 'Fault'
        group.selectedRackLabel.setText(f'Rack {rack_id} · {rack_status}')
        group.localButtons[0].setText(f'Open {rack_id}')
        group.localButtons[0].setEnabled(available and not active)
        group.localButtons[1].setEnabled(available and (active or ventilated))
        group.localButtons[1].setText('Close group' if ventilated else f'Close {rack_id}')
        group.localButtons[2].setEnabled(available and not ventilated)
        group.localButtons[2].setText('Ventilating…' if state.get('system_state') == 'VENTILATING' else 'Ventilate group')
        light_on = self.light_data[index].get(group.selected_rack_id, False)
        group.localButtons[3].setText('Turn light off' if light_on else 'Turn light on')
        group.localButtons[3].setEnabled(ready and not busy and state.get('system_state') != 'ERROR')
        if group.localButtons[3].property('illuminated') != light_on:
            group.localButtons[3].setProperty('illuminated', light_on)
            group.localButtons[3].style().unpolish(group.localButtons[3])
            group.localButtons[3].style().polish(group.localButtons[3])
        reason = ('Start this group to operate its racks.' if not worker or not worker.isRunning() else
                  'Connected mode: send commands from IPCSIM.' if worker.master_controller.port else
                  'Wait for the current movement to complete.' if busy else
                  'Clear the fault before moving racks.' if not healthy else '')
        for button, tip in zip(group.localButtons, (
            'This rack is already open.' if active else f'Open the access aisle for rack {rack_id}.',
            'Close the ventilated group.' if ventilated else f'Close the access aisle for rack {rack_id}.' if active else 'Select the open rack to close it.',
            'This group is already ventilated.' if ventilated else 'Space all six racks evenly for ventilation.',
            f'Turn the light {"off" if light_on else "on"} in rack {rack_id}.',
        )):
            button.setToolTip(reason or tip)
        for button in group.rackButtons:
            number = int(button.text())
            info = state.get('racks', {}).get(number, {})
            status = info.get('access_state', 'CLOSED').title()
            button.setToolTip(f'Rack {number} · {status} · Light {"on" if self.light_data[index].get(number) else "off"}')
        group.homeButton.setEnabled(available and (state.get('current_gap') != 6 or state.get('active_rack') is not None))

    def display_gap_state(self, state):
        worker = self.sender()
        if self.rack_group.get(worker.index) is not worker:
            return
        group = self.uic.rackGroupList[worker.index]
        previous = (group.rackGroupImage.gap_state or {}).get('racks', {})
        for rack_id, rack in state['racks'].items():
            if rack != previous.get(rack_id) or rack_id not in group.speedGraph.history:
                group.speedGraph.add_sample(rack_id, state['captured_at'],
                                            rack['speed_mm_s'], rack['displacement_mm'])
        group.rackGroupImage.set_gap_state(state)
        gap = state['current_gap']
        if gap is None:
            group.gapStateLineEdit.setText('5 gaps × 20 mm' if state['system_state'] == 'VENTILATED' else 'Distributing gaps')
        else:
            location = 'HOME / Right of R6' if gap == 6 else f'R{gap} ↔ R{gap + 1}'
            group.gapStateLineEdit.setText(f"Gap {gap} = {location}")
        moving = state.get('moving')
        command = state.get('current_command')
        if moving:
            text = f"MOVING RACK {moving['rack_id']} {moving['direction']}"
            if command:
                text += f"  /  {command['action']} RACK {command['rack_id']}"
        elif state.get('system_state') == 'ERROR':
            text = f"ERROR  /  {state.get('last_error') or 'Movement stopped'}"
        elif command:
            text = f"{command['action']} RACK {command['rack_id']}"
        elif state.get('active_rack') is not None:
            text = f"RACK {state['active_rack']} OPEN"
        elif state.get('system_state') == 'VENTILATED':
            text = 'GROUP VENTILATED'
        else:
            text = 'HOME  /  READY' if state['current_gap'] == 6 else 'IDLE'
        group.rackGroupStateLineEdit.setText(text)
        self.display_physical_motion(worker.index)
        self.update_operation_controls(worker.index)

    def display_physical_motion(self, index):
        group = self.uic.rackGroupList[index]
        state = group.rackGroupImage.gap_state or {}
        rack = state.get('racks', {}).get(group.selected_rack_id)
        if rack is None:
            return
        group.movementSpeed.display(rack['speed_mm_s'])
        group.displacement.display(rack['displacement_mm'])
        group.motionDetails.setText(
            f"Rack {rack['rack_id']} · State: {rack['movement_state'].replace('_', ' ')} · {rack.get('access_state', 'CLOSED')}\n"
            f"Position: {rack['start_position_mm']:.0f} → {rack['target_position_mm']:.0f} mm"
            f" · Now: {rack['position_mm']:.1f} mm · Slot: {rack['slot']}\n"
            f"Duration: {rack['duration_s']:.1f} s · Progress: {rack['progress_percent']:.0f}%")

    def display_environment_status(self, message: str):
        index = self.sender().index 
        if self.rack_group.get(index) is self.sender():
            rack_id, temperature, humidity, weight, smoke = self.handle_environment_status(message)
            self.environment_data[index][rack_id] = (temperature, humidity, weight, smoke)
            if rack_id == self.uic.rackGroupList[index].selected_rack_id:
                self.display_selected_rack(index)

    def display_selected_rack(self, group_index, selected_rack_text=None):
        rack_group = self.uic.rackGroupList[group_index]
        selected_rack_id = rack_group.selected_rack_id if selected_rack_text is None else int(selected_rack_text)
        if not selected_rack_id:
            return

        rack_id = selected_rack_id
        environment_values = self.environment_data[group_index].get(rack_id)
        if environment_values:
            temperature, humidity, weight, smoke = environment_values
            rack_group.temperature.display('{:.02f}'.format(temperature))
            rack_group.humidity.display('{:.02f}'.format(humidity))
            rack_group.weight.display('{:.02f}'.format(weight))
            rack_group.smoke.display(smoke)

        operation_values = self.operation_data[group_index].get(rack_id)
        if operation_values:
            movement_speed, displacement, is_hard_locked, _, rack_group_state = operation_values
            rack_group.movementSpeed.display('{:.02f}'.format(movement_speed))
            rack_group.displacement.display('{:.02f}'.format(displacement))
            rack_group.isHardLock.display(is_hard_locked)

            self.display_rack_group_state(rack_id, group_index, rack_group_state)
        if rack_id in self.light_data[group_index]:
            rack_group.light.display(self.light_data[group_index][rack_id])
        self.show_selected_breakdown(group_index)
        self.display_physical_motion(group_index)
        self.update_operation_controls(group_index)

    def display_operation_status(self, message, timestamp, light):
        worker = self.sender()
        index = worker.index
        if self.rack_group.get(index) is not worker or worker.master_controller.stop_event.is_set():
            return
        try:
            rack_id, speed, displacement, locked, endpoint, state = self.handle_operation_status(message)
            if rack_id not in worker.master_controller.rack_ids:
                return
            if not all(math.isfinite(v) and v >= 0 for v in (timestamp, speed, displacement)):
                return
        except (ValueError, IndexError):
            return
        group = self.uic.rackGroupList[index]
        values = (speed, displacement, locked, endpoint, state)
        self.operation_data[index][rack_id] = values
        self.light_data[index][rack_id] = light
        group.rackGroupImage.set_rack(rack_id, operation=values)
        if group.rackGroupImage.gap_state is not None:
            group.rackGroupImage.gap_state.setdefault('lights', {})[rack_id] = light
        if rack_id == group.selected_rack_id:
            group.movementSpeed.display(speed)
            group.displacement.display(displacement)
            group.isHardLock.display(locked)
            group.light.display(light)
            self.display_rack_group_state(rack_id, index, state)
            self.display_physical_motion(index)
        self.update_operation_controls(index)

    def show_selected_breakdown(self, index):
        group = self.uic.rackGroupList[index]
        rack_id = group.selected_rack_id
        flags = self.breakdown_data[index].get(rack_id, (0, 0, 0))
        labels = [label for label, flag in zip(('Obstructed', 'Skewed', 'Overload Motor'), flags) if flag]
        group.rackGroupErrorLineEdit.setText(f'Rack {rack_id}: ' + ' | '.join(labels) if labels else '')

    def display_breakdown_status(self, message):
        worker = self.sender()
        if self.rack_group.get(worker.index) is worker:
            rack_id, *flags = self.handle_breakdown_status(message)
            self.breakdown_data[worker.index][rack_id] = flags
            group = self.uic.rackGroupList[worker.index]
            group.rackGroupImage.set_rack(rack_id, faults=flags)
            self.show_selected_breakdown(worker.index)
            self.update_operation_controls(worker.index)
            if rack_id == group.selected_rack_id and rack_id in self.operation_data[worker.index]:
                self.display_rack_group_state(rack_id, worker.index, self.operation_data[worker.index][rack_id][-1])
            if worker.isRunning() and not worker.master_controller.stop_event.is_set():
                faults = any(any(v) for v in self.breakdown_data[worker.index].values())
                self.uic.set_group_status(worker.index, 'error' if faults else 'normal', 'FAULT' if faults else 'RUNNING')


class ThreadClass(QtCore.QThread):
    env_signal = pyqtSignal(str)
    opr_signal = pyqtSignal(str)
    operation_sample = pyqtSignal(str, float, bool)
    brk_signal = pyqtSignal(str)
    gap_signal = pyqtSignal(object)
    ready = pyqtSignal(str)
    failed = pyqtSignal(str)

    def __init__(self, index=0, rack_id=None, err_numbers=None, port=None):
        super().__init__()
        self.index = index
        self.master_controller = MasterCom(rack_group_id=index, port=port)
        self.rack_id = rack_id if rack_id is not None else index * MAX_RACK_NUMBER + 1
        self.err_numbers = list(err_numbers or [])
        self.failure = ''

    def run(self):
        controller = self.master_controller
        try:
            controller.start()
            if not controller.is_run:
                return
            self.gap_signal.emit(controller.gap_snapshot())
            self.ready.emit(f'Serial connected: {controller.port}' if controller.port else
                            'Standalone simulation - no IPC connection')
            signals = {'ENVSTT': self.env_signal, 'OPRSTT': self.opr_signal, 'BRKSTT': self.brk_signal}
            while not controller.stop_event.is_set():
                if controller.poll():
                    self.gap_signal.emit(controller.gap_snapshot())
                while True:
                    try:
                        message = controller.messages.get_nowait()
                    except Empty:
                        break
                    signals[message.split('|', 1)[0]].emit(message)
                while True:
                    try:
                        sample = controller.operation_samples.get_nowait()
                    except Empty:
                        break
                    self.operation_sample.emit(*sample)
                controller.stop_event.wait(0.02)
        except Exception as exc:
            self.failure = str(exc)
            self.failed.emit(self.failure)
        finally:
            try:
                controller.execute_stopRunning()
            except Exception as exc:
                self.failure = str(exc)
                self.failed.emit(self.failure)

    def stop(self):
        # The worker closes its own Serial handle, never QThread.terminate().
        self.master_controller.stop_event.set()

    def run_error(self):
        self.master_controller.requests.put(('fault', (self.rack_id, self.err_numbers)))

    def stop_error(self):
        self.master_controller.requests.put(('fault', (self.rack_id, [])))


if __name__ == '__main__':
    app = QApplication(sys.argv)
    main_win = MainWindow()
    main_win.show()
    sys.exit(app.exec())

