"""Responsive PyQt dashboard composition (maintained source, not generated UI)."""
from PyQt6 import QtCore, QtGui, QtWidgets
try:
    from .dashboard_widgets import MetricCard, RackCanvas, OperationChart, COLORS
    from .topology import GROUP_COUNT
except ImportError:
    from dashboard_widgets import MetricCard, RackCanvas, OperationChart, COLORS
    from topology import GROUP_COUNT

STYLE = """
QMainWindow, QWidget#root { background: #eef2f7; color: #24354e; }
QWidget { font-family: 'Segoe UI'; font-size: 12px; color: #24354e; }
QFrame#panel { background: white; border: 1px solid #dce4ee; border-radius: 10px; }
QFrame#metric { background: #f6f8fc; border: 1px solid #e5ebf3; border-radius: 7px; }
QLabel { background: transparent; border: none; }
QLabel#section { font-size: 12px; font-weight: 700; color: #38516f; }
QLabel#heading { font-size: 23px; font-weight: 700; }
QLabel#muted, QLabel#metricTitle { color: #73859c; font-size: 11px; }
QLabel#reading { font-size: 24px; font-weight: 600; color: #193a62; }
QLabel#badge { background: #edf2f8; border-radius: 5px; padding: 5px 9px; color: #62758e; }
QPushButton { background: #f3f6fb; border: 1px solid #d6e0ed; border-radius: 5px; padding: 6px 10px; font-weight: 600; }
QPushButton:hover { background: #e7effc; border-color: #8fb4ef; }
QPushButton:checked, QPushButton#primary { background: #2563eb; color: white; border-color: #2563eb; }
QPushButton#stop { color: #c44754; background: #fff3f4; border-color: #efd2d7; }
QPushButton#openRack { background: #e9f6f0; color: #13765b; border-color: #a7d8c6; }
QPushButton#closeRack { background: #edf3ff; color: #2459ad; border-color: #b5ccef; }
QPushButton[illuminated="true"] { background: #fff4ce; color: #886000; border-color: #e8c96a; }
QPushButton#openRack:disabled, QPushButton#closeRack:disabled { background: #f5f7fa; color: #aeb9c8; border-color: #e7edf4; }
QPushButton:disabled { background: #f5f7fa; color: #aeb9c8; border-color: #e7edf4; }
QPushButton#primary:disabled, QPushButton#stop:disabled { background: #f5f7fa; color: #aeb9c8; border-color: #e7edf4; }
QComboBox { padding: 5px 9px; border: 1px solid #d6e0ed; border-radius: 5px; background: white; min-height: 19px; }
QComboBox:disabled { background: #f4f6f9; color: #8f9eb0; }
QListWidget { background: #13273f; border: none; border-radius: 8px; color: #b7c9df; outline: none; }
QListWidget::item { padding: 10px 7px; border-radius: 5px; margin: 2px 4px; }
QListWidget::item:selected { background: #28558e; color: white; }
QListWidget::item:hover { background: #203e61; }
QScrollArea { border: none; background: transparent; }
QCheckBox { spacing: 7px; }
QCheckBox::indicator { width: 15px; height: 15px; }
QScrollBar:vertical { background: #eaf0f7; width: 8px; }
QScrollBar::handle:vertical { background: #a8b8cc; border-radius: 4px; min-height: 24px; }
"""


def label(text, name=None):
    item = QtWidgets.QLabel(text)
    item.setSizePolicy(QtWidgets.QSizePolicy.Policy.Preferred, QtWidgets.QSizePolicy.Policy.Fixed)
    if name:
        item.setObjectName(name)
    return item


def panel(title):
    frame = QtWidgets.QFrame()
    frame.setObjectName('panel')
    layout = QtWidgets.QVBoxLayout(frame)
    layout.setContentsMargins(12, 7, 12, 7)
    layout.setSpacing(6)
    layout.addWidget(label(title, 'section'))
    return frame, layout


class MyGroupBox:
    def __init__(self, rack_group_id):
        self.rack_group_id = rack_group_id
        self.selected_rack_id = (rack_group_id - 1) * 6 + 1
        self.rackGroup = QtWidgets.QWidget()
        self.rackGroup.setMinimumSize(850, 660)
        root = QtWidgets.QVBoxLayout(self.rackGroup)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(8)
        heading = QtWidgets.QHBoxLayout()
        titles = QtWidgets.QVBoxLayout()
        titles.setSpacing(0)
        titles.addWidget(label(f'Group {rack_group_id:02d}  /  Rack monitoring', 'heading'))
        titles.addWidget(label('SMART INVENTORY   /   SIMULATION WORKSPACE', 'muted'))
        heading.addLayout(titles)
        heading.addStretch()
        self.sessionBadge = label('STOPPED', 'badge')
        heading.addWidget(self.sessionBadge)
        root.addLayout(heading)

        rack_panel, rack_layout = panel('01   RACK OVERVIEW')
        rack_panel.setMaximumHeight(240)
        self.rackGroupImage = RackCanvas(self.selected_rack_id)
        rack_heading = QtWidgets.QHBoxLayout()
        rack_heading.addWidget(rack_layout.takeAt(0).widget())
        rack_heading.addStretch()
        rack_heading.addWidget(label('Click a rack to select · Green: open / ventilated · Yellow: light on', 'muted'))
        rack_layout.addLayout(rack_heading)
        rack_layout.addWidget(self.rackGroupImage, 1)
        root.addWidget(rack_panel, 2)

        controls, layout = panel('02   CONNECTION & CONTROL')
        connection = QtWidgets.QHBoxLayout()
        connection.addWidget(label('Serial port', 'muted'))
        self.serialPort = QtWidgets.QComboBox()
        self.serialPort.setEditable(True)
        self.serialPort.setMinimumWidth(215)
        self.serialPort.setSizePolicy(QtWidgets.QSizePolicy.Policy.Expanding, QtWidgets.QSizePolicy.Policy.Fixed)
        connection.addWidget(self.serialPort, 2)
        self.connectionStatus = label('Stopped', 'badge')
        self.connectionStatus.setWordWrap(True)
        self.connectionStatus.setMinimumWidth(130)
        connection.addWidget(self.connectionStatus, 2)
        self.runButton = QtWidgets.QPushButton('Start Simulating')
        self.runButton.setObjectName('primary')
        self.stopButton = QtWidgets.QPushButton('Stop')
        self.stopButton.setObjectName('stop')
        self.homeButton = QtWidgets.QPushButton('Return Home')
        self.homeButton.setToolTip('Move the access gap back to the right of Rack 6')
        self.homeButton.setEnabled(False)
        connection.addWidget(self.runButton)
        connection.addWidget(self.stopButton)
        connection.addWidget(self.homeButton)
        layout.addLayout(connection)
        commands = QtWidgets.QHBoxLayout()
        commands.addWidget(label('Rack', 'muted'))
        self.rackButtons = []
        for rack_id in range(self.selected_rack_id, self.selected_rack_id + 6):
            button = QtWidgets.QPushButton(str(rack_id))
            button.setCheckable(True)
            button.setMinimumWidth(33)
            button.setChecked(rack_id == self.selected_rack_id)
            commands.addWidget(button)
            self.rackButtons.append(button)
        commands.addSpacing(12)
        self.localButtons = []
        for text in ('Open', 'Close', 'Ventilate group', 'Light on'):
            button = QtWidgets.QPushButton(text)
            commands.addWidget(button, 1)
            self.localButtons.append(button)
        self.localButtons[0].setObjectName('openRack')
        self.localButtons[1].setObjectName('closeRack')
        layout.addLayout(commands)
        self.rackGroupStateLineEdit = label('No operation data', 'muted')
        self.gapStateLineEdit = label('GAP 6  /  IDLE', 'badge')
        state_row = QtWidgets.QHBoxLayout()
        title = layout.takeAt(0).widget()
        title.deleteLater()
        self.selectedRackLabel = label(f'Rack {self.selected_rack_id} · Closed', 'section')
        state_row.addWidget(self.selectedRackLabel)
        state_row.addStretch()
        state_row.addWidget(self.gapStateLineEdit)
        state_row.addWidget(self.rackGroupStateLineEdit)
        layout.insertLayout(0, state_row)
        root.addWidget(controls)

        monitoring = QtWidgets.QHBoxLayout()
        monitoring.setSpacing(10)
        env, env_layout = panel('03   ENVIRONMENT & SENSORS')
        grid = QtWidgets.QGridLayout()
        grid.setSpacing(8)
        binary = (('OFF', '#8291a5'), ('ON', '#168268'))
        specs = [('temperature', 'Temperature', '♨', '°C', None),
                 ('weight', 'Weight', '▱', 'kg', None),
                 ('humidity', 'Humidity', '◉', '% RH', None),
                 ('smoke', 'Smoke', '≋', '', (('CLEAR', '#168268'), ('DETECTED', '#d14452'))),
                 ('light', 'Light', '☼', '', binary),
                 ('isHardLock', 'Hard Locked', '▣', '', (('UNLOCKED', '#8291a5'), ('LOCKED', '#168268')))]
        for index, (name, title, icon, unit, states) in enumerate(specs):
            widget = MetricCard(title, icon, unit, states)
            setattr(self, name, widget)
            grid.addWidget(widget, index // 3, index % 3)
            grid.setColumnStretch(index % 3, 1)
        env_layout.addLayout(grid, 1)
        env_layout.addWidget(label('Readings from the selected simulated rack', 'muted'))
        monitoring.addWidget(env, 5)
        opr, opr_layout = panel('04   OPERATION · LIVE HISTORY')
        values = QtWidgets.QHBoxLayout()
        self.movementSpeed = MetricCard('Speed', '↗', 'mm/s', compact=True)
        self.displacement = MetricCard('Displacement', '↔', 'mm', compact=True)
        values.addWidget(self.movementSpeed)
        values.addWidget(self.displacement)
        opr_layout.addLayout(values)
        self.motionDetails = label('Select a rack to inspect physical movement', 'muted')
        self.motionDetails.setWordWrap(True)
        opr_layout.addWidget(self.motionDetails)
        self.speedGraph = OperationChart()
        opr_layout.addWidget(self.speedGraph, 1)
        monitoring.addWidget(opr, 6)
        root.addLayout(monitoring, 4)

        faults, fault_layout = panel('05   FAULT SIMULATION')
        options = QtWidgets.QHBoxLayout()
        self.ObstructCheckBox = QtWidgets.QCheckBox('Obstruction')
        self.SkewCheckBox = QtWidgets.QCheckBox('Skew')
        self.OverloadMotorCheckBox = QtWidgets.QCheckBox('Motor overload')
        for checkbox in (self.ObstructCheckBox, self.SkewCheckBox, self.OverloadMotorCheckBox):
            options.addWidget(checkbox)
        options.addStretch()
        self.simulatorErrorButton = QtWidgets.QPushButton('Apply / clear faults')
        options.addWidget(self.simulatorErrorButton)
        fault_layout.addLayout(options)
        self.rackGroupErrorLineEdit = label('', 'muted')
        self.rackGroupErrorLineEdit.setWordWrap(True)
        fault_title = fault_layout.takeAt(0).widget()
        fault_heading = QtWidgets.QHBoxLayout()
        fault_heading.addWidget(fault_title)
        fault_heading.addStretch()
        fault_heading.addWidget(self.rackGroupErrorLineEdit)
        fault_layout.insertLayout(0, fault_heading)
        root.addWidget(faults)


class Ui_MainWindow:
    def __init__(self, *args):
        self.rackGroupList = []

    def setupUi(self, window):
        window.setWindowTitle('Smart Inventory | Simulation Monitor')
        window.resize(1440, 900)
        window.setStyleSheet(STYLE)
        self.centralwidget = QtWidgets.QWidget()
        self.centralwidget.setObjectName('root')
        layout = QtWidgets.QHBoxLayout(self.centralwidget)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(14)
        self.groupSelector = QtWidgets.QListWidget()
        self.groupSelector.setFixedWidth(125)
        self.groupSelector.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.groupStack = QtWidgets.QStackedWidget()
        for index in range(GROUP_COUNT):
            group = MyGroupBox(index + 1)
            self.rackGroupList.append(group)
            self.groupStack.addWidget(group.rackGroup)
            self.groupSelector.addItem(f'●   GROUP {index + 1:02d}')
        self.groupSelector.currentRowChanged.connect(self.groupStack.setCurrentIndex)
        self.groupSelector.setCurrentRow(0)
        self.scrollArea = QtWidgets.QScrollArea()
        self.scrollArea.setWidgetResizable(True)
        self.scrollArea.setWidget(self.groupStack)
        layout.addWidget(self.groupSelector)
        layout.addWidget(self.scrollArea, 1)
        window.setCentralWidget(self.centralwidget)

    def set_group_status(self, index, tone, text):
        item = self.groupSelector.item(index)
        item.setForeground(QtGui.QColor(COLORS[tone]))
        item.setToolTip(text)
        group = self.rackGroupList[index]
        group.sessionBadge.setText(text)
        group.sessionBadge.setStyleSheet(f'color: {COLORS[tone]}; background: #eef3f9;')
