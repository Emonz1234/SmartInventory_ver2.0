"""PySide6 operator console shared by IPC and IPCSIM; networking stays off the UI thread."""
import json
import queue
import time
import uuid
from PySide6 import QtCore, QtWidgets
from ipc_core.operator_client import OperatorClient, read_edge


class ClientWorker(QtCore.QThread):
    snapshot = QtCore.Signal(dict)
    notice = QtCore.Signal(str)
    authenticated = QtCore.Signal(bool)

    def __init__(self, settings):
        super().__init__()
        self.settings = settings
        self.jobs = queue.Queue()

    def run(self):
        client = OperatorClient(self.settings.SERVER_URL) if self.settings.SERVER_URL else None
        logged_in = False
        next_poll = 0
        host = self.settings.EDGE_API_HOST
        if host in ('0.0.0.0', '::'):
            host = '127.0.0.1'
        edge_url = f'http://{host}:{self.settings.EDGE_API_PORT}'
        while not self.isInterruptionRequested():
            try:
                kind, data = self.jobs.get(timeout=.1)
                if not client:
                    raise ValueError('Cấu hình SERVER_URL để đăng nhập và điều khiển')
                if kind == 'login':
                    logged_in = False
                    self.authenticated.emit(False)
                    client.login(**data)
                    logged_in = True
                    self.authenticated.emit(True)
                    self.notice.emit('Đã đăng nhập Server')
                elif kind == 'logout':
                    client.cookies.clear()
                    logged_in = False
                    self.authenticated.emit(False)
                elif logged_in:
                    result = client.request(data['path'], 'POST', data['body'])
                    self.notice.emit(json.dumps(result, ensure_ascii=False))
                else:
                    raise ValueError('Cần đăng nhập Server trước khi thao tác')
                next_poll = 0
            except queue.Empty:
                pass
            except Exception as exc:
                self.notice.emit(str(exc))
            if time.monotonic() >= next_poll:
                try:
                    state = read_edge(edge_url, self.settings.EDGE_API_TOKEN)
                    self.snapshot.emit(state)
                except Exception as exc:
                    self.snapshot.emit({'health': {}, 'error': str(exc)})
                next_poll = time.monotonic() + 2


class EdgeWindow(QtWidgets.QMainWindow):
    def __init__(self, settings, process=None):
        super().__init__()
        self.settings, self.process = settings, process
        self.logged_in, self.health = False, {}
        self.setWindowTitle(f'Smart Inventory · {settings.DEVICE_TYPE} · {settings.DEVICE_ID}')
        self.resize(1150, 760)
        root = QtWidgets.QWidget()
        self.setCentralWidget(root)
        layout = QtWidgets.QVBoxLayout(root)
        self.status = QtWidgets.QLabel('Đang khởi động dịch vụ local...')
        layout.addWidget(self.status)
        auth = QtWidgets.QHBoxLayout()
        self.username, self.password = QtWidgets.QLineEdit(), QtWidgets.QLineEdit()
        self.username.setPlaceholderText('Tài khoản Server')
        self.password.setPlaceholderText('Mật khẩu (không lưu)')
        self.password.setEchoMode(QtWidgets.QLineEdit.EchoMode.Password)
        login = QtWidgets.QPushButton('Đăng nhập Server')
        logout = QtWidgets.QPushButton('Đăng xuất')
        for widget in (self.username, self.password, login, logout):
            auth.addWidget(widget)
        layout.addLayout(auth)
        command = QtWidgets.QHBoxLayout()
        self.rack = QtWidgets.QComboBox()
        command.addWidget(self.rack, 2)
        self.buttons = []
        for action in ('OPEN', 'CLOSE', 'VENTILATE', 'LIGHT'):
            button = QtWidgets.QPushButton(action)
            button.clicked.connect(lambda checked=False, action=action: self.command(action))
            command.addWidget(button)
            self.buttons.append(button)
        layout.addLayout(command)
        inventory = QtWidgets.QHBoxLayout()
        self.item, self.bin = QtWidgets.QComboBox(), QtWidgets.QComboBox()
        self.quantity = QtWidgets.QSpinBox()
        self.quantity.setRange(0, 1000000)
        self.quantity.setPrefix('Số lượng: ')
        inventory.addWidget(self.item, 2)
        inventory.addWidget(self.bin, 2)
        inventory.addWidget(self.quantity)
        for action in ('PUT', 'PICK', 'ADJUST'):
            button = QtWidgets.QPushButton(action)
            button.clicked.connect(lambda checked=False, action=action: self.command(action))
            inventory.addWidget(button)
            self.buttons.append(button)
        layout.addLayout(inventory)
        self.tabs = QtWidgets.QTabWidget()
        self.tables = {}
        for name in ('Giá tủ', 'Tồn kho cache', 'Lệnh chờ xác nhận', 'Sự kiện local'):
            table = QtWidgets.QTableWidget()
            table.setEditTriggers(QtWidgets.QAbstractItemView.EditTrigger.NoEditTriggers)
            table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectionBehavior.SelectRows)
            self.tables[name] = table
            self.tabs.addTab(table, name)
        layout.addWidget(self.tabs, 1)
        confirmation = QtWidgets.QHBoxLayout()
        self.operation = QtWidgets.QComboBox()
        self.evidence = QtWidgets.QLineEdit()
        self.evidence.setPlaceholderText('Bằng chứng kết quả thực tế, bắt buộc khi xác nhận')
        self.success = QtWidgets.QPushButton('Xác nhận thành công')
        self.failure = QtWidgets.QPushButton('Xác nhận thất bại')
        for widget in (self.operation, self.evidence, self.success, self.failure):
            confirmation.addWidget(widget)
        layout.addLayout(confirmation)
        self.message = QtWidgets.QLabel('Offline: chỉ xem cache và ghi nhận telemetry. Điều khiển cần Server online.')
        self.message.setWordWrap(True)
        self.message.setTextFormat(QtCore.Qt.TextFormat.PlainText)
        layout.addWidget(self.message)
        self.worker = ClientWorker(settings)
        self.worker.snapshot.connect(self.display)
        self.worker.notice.connect(self.message.setText)
        self.worker.authenticated.connect(self.auth_changed)
        login.clicked.connect(self.login)
        logout.clicked.connect(lambda: self.worker.jobs.put(('logout', {})))
        self.success.clicked.connect(lambda: self.confirm(True))
        self.failure.clicked.connect(lambda: self.confirm(False))
        self.update_controls()
        self.worker.start()

    def login(self):
        self.worker.jobs.put(('login', {'username': self.username.text(), 'password': self.password.text()}))
        self.password.clear()

    def auth_changed(self, authenticated):
        self.logged_in = authenticated
        self.update_controls()

    def update_controls(self):
        ready = self.logged_in and self.health.get('server_synced') and self.health.get('serial_connected')
        for button in self.buttons:
            button.setEnabled(bool(ready and self.rack.count() and self.settings.DEVICE_TYPE == 'IPCSIM'))
        for button in (self.success, self.failure):
            button.setEnabled(bool(self.logged_in and self.operation.count()))

    @staticmethod
    def fill(table, rows):
        columns = list(dict.fromkeys(k for row in rows for k in row))
        table.setColumnCount(len(columns))
        table.setHorizontalHeaderLabels(columns)
        table.setRowCount(len(rows))
        for i, row in enumerate(rows):
            for j, key in enumerate(columns):
                value = row.get(key, '')
                text = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
                table.setItem(i, j, QtWidgets.QTableWidgetItem(text))
        table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setStretchLastSection(True)

    @staticmethod
    def choices(combo, pairs):
        previous = combo.currentData()
        combo.clear()
        for title, value in pairs:
            combo.addItem(title, value)
        index = combo.findData(previous)
        if index >= 0:
            combo.setCurrentIndex(index)

    def display(self, data):
        self.health = data.get('health', {})
        h = self.health
        self.status.setText(f"{self.settings.DEVICE_ID} | MQTT/Server: {h.get('server_online', False)} | "
                            f"Serial: {h.get('serial_connected', False)} | Revision: {h.get('revision', '-')} | "
                            f"Đồng bộ: {h.get('server_synced', False)} | Outbox: {data.get('outbox_count', '-')}")
        if 'error' in data:
            self.message.setText('Dịch vụ local chưa sẵn sàng: ' + data['error'])
            self.update_controls()
            return
        records = data.get('records', [])
        racks = [r['data'] for r in records if r['kind'] == 'rack']
        self.choices(self.rack, [(f"{r['rack_code']} · {r['rack_name']}", r['id']) for r in racks])
        self.choices(self.item, [(r['data']['item_name'], r['data']['id']) for r in records if r['kind'] == 'item'])
        self.choices(self.bin, [(r['data']['bin_code'], r['data']['id']) for r in records if r['kind'] == 'bin'])
        self.fill(self.tables['Giá tủ'], [{'address': key, **value} for key, value in data['racks'].items()])
        self.fill(self.tables['Tồn kho cache'], [r['data'] for r in records if r['kind'] == 'stock'])
        pending = data.get('pending', [])
        self.fill(self.tables['Lệnh chờ xác nhận'], pending)
        self.choices(self.operation, [(f"{op['id']} · {op['state']}", op['id']) for op in pending])
        self.fill(self.tables['Sự kiện local'], data.get('events', []))
        self.update_controls()

    def command(self, action):
        if not (self.logged_in and self.health.get('server_synced') and self.health.get('serial_connected')):
            return
        body = {'device_id': self.settings.DEVICE_ID, 'rack_id': self.rack.currentData(),
                'kind': action, 'request_key': str(uuid.uuid4())}
        if action in ('PUT', 'PICK', 'ADJUST'):
            body.update(item_id=self.item.currentData(), bin_id=self.bin.currentData(), quantity=self.quantity.value())
        self.worker.jobs.put(('request', {'path': 'operations', 'body': body}))
        self.message.setText('Đã gửi yêu cầu đến Server; không tự gửi lại khi timeout. Kiểm tra danh sách lệnh trên Server.')

    def confirm(self, success):
        if not self.evidence.text().strip() or not self.operation.currentData():
            self.message.setText('Chọn lệnh và nhập bằng chứng trước khi xác nhận')
            return
        self.worker.jobs.put(('request', {'path': f'operations/{self.operation.currentData()}/confirm',
                                         'body': {'note': self.evidence.text(), 'success': success}}))

    def closeEvent(self, event):
        self.worker.requestInterruption()
        if self.worker.isRunning():
            event.ignore()
            QtCore.QTimer.singleShot(100, self.close)
        else:
            event.accept()


def run(settings, process=None):
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    window = EdgeWindow(settings, process)
    window.show()
    app.exec()
