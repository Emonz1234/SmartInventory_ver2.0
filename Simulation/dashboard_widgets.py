"""Presentation widgets. No generated readings and no hardware control logic."""
from collections import deque
import math
import time

from PyQt6 import QtCore, QtGui, QtWidgets

COLORS = {'muted': '#8291a5', 'normal': '#168268', 'active': '#2563eb',
          'warning': '#d48a16', 'error': '#d14452'}


class MetricCard(QtWidgets.QFrame):
    """LCD-compatible display interface, with readable units and binary states."""
    def __init__(self, title, icon, unit='', states=None, parent=None, compact=False):
        super().__init__(parent)
        self.setObjectName('metric')
        self.states, self.number = states, None
        layout = QtWidgets.QHBoxLayout(self) if compact else QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(10, 6, 10, 6)
        layout.setSpacing(3)
        heading = QtWidgets.QLabel(f'{icon}  {title}')
        heading.setObjectName('metricTitle')
        self.reading = QtWidgets.QLabel('—')
        self.reading.setObjectName('reading')
        self.reading.installEventFilter(self)
        self.unit = QtWidgets.QLabel(unit or 'No data yet')
        self.unit.setObjectName('muted')
        layout.addWidget(heading)
        layout.addWidget(self.reading)
        layout.addWidget(self.unit)
        self.setMinimumHeight(52 if compact else 76)

    def display(self, value):
        number = float(value)
        if not math.isfinite(number):
            return
        self.number = number
        if self.states:
            text, color = self.states[int(bool(number))]
            self.reading.setText(text)
            self.reading.setStyleSheet(f'color: {color};')
            self.unit.setText('Binary state')
        else:
            self.reading.setText(f'{number:.2f}')
        self.fit_reading()

    def fit_reading(self):
        if self.number is None:
            return
        font = QtGui.QFont('Segoe UI')
        font.setWeight(QtGui.QFont.Weight.DemiBold)
        size = 17 if self.states else 24
        available = max(1, self.reading.width())
        while size > 11:
            font.setPixelSize(size)
            if QtGui.QFontMetrics(font).horizontalAdvance(self.reading.text()) <= available:
                break
            size -= 1
        color = self.states[int(bool(self.number))][1] if self.states else '#193a62'
        style = f'color: {color}; font-size: {size}px;'
        if self.reading.styleSheet() != style:
            self.reading.setStyleSheet(style)

    def eventFilter(self, watched, event):
        if watched is self.reading and event.type() == QtCore.QEvent.Type.Resize:
            self.fit_reading()
        return super().eventFilter(watched, event)

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.fit_reading()

    def value(self):
        return self.number


class RackCanvas(QtWidgets.QWidget):
    rackClicked = QtCore.pyqtSignal(int)

    def __init__(self, first_rack, parent=None):
        super().__init__(parent)
        self.rack_ids = list(range(first_rack, first_rack + 6))
        self.selected = first_rack
        self.operations, self.faults = {}, {}
        self.setMinimumHeight(96)
        self.setMaximumHeight(220)
        self.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
        self.setToolTip('Select a rack to inspect its readings and operation history')
        self.setAccessibleName('Six racks with live position, lock and fault status')

    def set_rack(self, rack_id, operation=None, faults=None):
        if operation is not None:
            self.operations[rack_id] = operation
        if faults is not None:
            self.faults[rack_id] = faults
        self.update()

    def select(self, rack_id):
        self.selected = rack_id
        self.update()

    def mousePressEvent(self, event):
        index = min(5, max(0, int(event.position().x() * 6 / max(1, self.width()))))
        self.rackClicked.emit(self.rack_ids[index])

    def paintEvent(self, event):
        painter = QtGui.QPainter(self)
        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
        width = self.width() / 6
        for i, rack in enumerate(self.rack_ids):
            operation = self.operations.get(rack)
            fault = any(self.faults.get(rack, ()))
            selected = rack == self.selected
            position = operation[1] if operation else 0
            locked = bool(operation[2]) if operation else None
            moving = operation and operation[0] > 0
            color = COLORS['error' if fault else 'active' if selected or moving else 'muted']
            rect = QtCore.QRectF(i * width + 4, 3, width - 8, self.height() - 6)
            painter.setPen(QtGui.QPen(QtGui.QColor(color), 2 if selected or fault else 1))
            painter.setBrush(QtGui.QColor('#eff5ff' if selected else '#f8fafc'))
            painter.drawRoundedRect(rect, 9, 9)
            painter.setPen(QtGui.QColor('#24354e'))
            font = painter.font()
            font.setBold(True)
            painter.setFont(font)
            painter.drawText(rect.adjusted(10, 7, -10, -rect.height() + 28),
                             QtCore.Qt.AlignmentFlag.AlignLeft, f'RACK {rack:02d}')
            font.setBold(False)
            painter.setFont(font)
            body = rect.adjusted(12, 34, -12, -39)
            painter.setBrush(QtGui.QColor('#dde5ee'))
            painter.setPen(QtGui.QPen(QtGui.QColor('#a9b8ca'), 1))
            painter.drawRoundedRect(body, 4, 4)
            # Each door stays inside its own column, preserving all six racks at any width.
            gap = min(0.32, max(0, position / 64) * 0.32) * body.width()
            door = body.adjusted(gap, 0, 0, 0)
            painter.setBrush(QtGui.QColor('#ffffff' if selected else '#f0f4f8'))
            painter.drawRoundedRect(door, 4, 4)
            if i == 0:
                painter.drawRoundedRect(door.adjusted(8, 8, -8, -body.height() * .64), 2, 2)
            handle = QtCore.QRectF(door.center().x() - 13, body.bottom() - 13, 26, 4)
            painter.setBrush(QtGui.QColor('#667b93'))
            painter.drawRoundedRect(handle, 2, 2)
            status = ('FAULT' if fault else 'MOVING' if moving else
                      'OPEN' if position > 0 else 'CLOSED') if operation else 'NO DATA'
            painter.setPen(QtGui.QColor(color))
            painter.drawText(rect.adjusted(9, rect.height() - 34, -9, -16),
                             QtCore.Qt.AlignmentFlag.AlignCenter, status)
            painter.setPen(QtGui.QColor('#667b93'))
            painter.drawText(rect.adjusted(9, rect.height() - 18, -9, -1),
                             QtCore.Qt.AlignmentFlag.AlignCenter,
                             'LOCKED' if locked else 'UNLOCKED' if locked is not None else '—')


class OperationChart(QtWidgets.QWidget):
    """Two axes, one time window; bounded per-rack acquisition history."""
    WINDOW_SECONDS = 60.0
    MAX_SAMPLES = 600

    def __init__(self, parent=None):
        super().__init__(parent)
        self.history = {}
        self.selected = None
        self.origin = None
        self.frozen_time = 0.0
        self.running = False
        self.setMinimumSize(320, 155)
        self.setSizePolicy(QtWidgets.QSizePolicy.Policy.Expanding, QtWidgets.QSizePolicy.Policy.Expanding)
        self.refresh = QtCore.QTimer(self)
        self.refresh.setInterval(200)
        self.refresh.timeout.connect(self.refresh_visible)

    def refresh_visible(self):
        if self.isVisible():
            self.update()  # Paint only; never append samples.

    def reset_session(self):
        self.refresh.stop()
        self.history.clear()
        self.origin = None
        self.frozen_time = 0.0
        self.running = False
        self.update()

    def start_session(self, origin):
        self.origin = origin
        self.running = True
        self.refresh.start()

    def stop_session(self):
        self.frozen_time = self.elapsed()
        self.running = False
        self.refresh.stop()
        self.update()

    def elapsed(self):
        return max(0.0, time.monotonic() - self.origin) if self.running and self.origin is not None else self.frozen_time

    def add_sample(self, rack_id, timestamp, speed, displacement):
        if not all(math.isfinite(v) and v >= 0 for v in (timestamp, speed, displacement)):
            return False
        buffer = self.history.setdefault(rack_id, deque(maxlen=self.MAX_SAMPLES))
        if buffer and timestamp < buffer[-1][0]:
            return False
        buffer.append((timestamp, speed, displacement))
        while buffer and buffer[0][0] < timestamp - self.WINDOW_SECONDS:
            buffer.popleft()
        self.frozen_time = max(self.frozen_time, timestamp)
        if rack_id == self.selected:
            self.update()
        return True

    def select_rack(self, rack_id):
        self.selected = rack_id
        self.update()

    def time_range(self):
        end = max(self.WINDOW_SECONDS, self.elapsed())
        return max(0.0, end - self.WINDOW_SECONDS), end

    def paintEvent(self, event):
        painter = QtGui.QPainter(self)
        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
        painter.setFont(QtGui.QFont('Segoe UI', 8))
        start, end = self.time_range()
        samples = [v for v in self.history.get(self.selected, ()) if start <= v[0] <= end]
        half = self.height() / 2
        for series, title, color in ((1, 'SPEED · m/s', '#2563eb'), (2, 'DISPLACEMENT · m', '#0f927c')):
            offset = (series - 1) * half
            area = QtCore.QRectF(43, offset + 23, self.width() - 58, half - 47)
            if area.height() <= 0:
                continue
            painter.setPen(QtGui.QColor(color))
            painter.drawText(QtCore.QPointF(8, offset + 14), title)
            maximum = max(1.0, max((v[series] for v in samples), default=0) * 1.15)
            for tick in range(4):
                y = area.bottom() - area.height() * tick / 3
                painter.setPen(QtGui.QPen(QtGui.QColor('#e1e8f1'), 1))
                painter.drawLine(QtCore.QPointF(area.left(), y), QtCore.QPointF(area.right(), y))
                painter.setPen(QtGui.QColor('#7b8ca1'))
                painter.drawText(QtCore.QRectF(0, y - 7, 37, 14), QtCore.Qt.AlignmentFlag.AlignRight,
                                 f'{maximum * tick / 3:.1f}')
            for tick in range(5):
                x = area.left() + area.width() * tick / 4
                painter.setPen(QtGui.QColor('#7b8ca1'))
                painter.drawText(QtCore.QRectF(x - 20, area.bottom() + 4, 40, 16),
                                 QtCore.Qt.AlignmentFlag.AlignCenter, f'{start + (end-start)*tick/4:.0f}')
            painter.drawText(QtCore.QRectF(area.right() - 88, offset + 1, 88, 17),
                             QtCore.Qt.AlignmentFlag.AlignRight, 'Elapsed time (s)')
            if not samples:
                painter.drawText(area, QtCore.Qt.AlignmentFlag.AlignCenter, 'Waiting for operation data')
                continue
            points = QtGui.QPolygonF([QtCore.QPointF(area.left() + (v[0]-start)/(end-start)*area.width(),
                                                   area.bottom() - v[series]/maximum*area.height()) for v in samples])
            painter.setPen(QtGui.QPen(QtGui.QColor(color), 2))
            painter.drawPolyline(points)
            painter.setBrush(QtGui.QColor(color))
            painter.drawEllipse(points[-1], 2.5, 2.5)
