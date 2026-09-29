"""Presentation widgets. No generated readings and no hardware control logic."""
from collections import deque
import math
import time

from PyQt6 import QtCore, QtGui, QtWidgets
try:
    from .gap_controller import RACK_PITCH_MM, SLOT_COUNT
except ImportError:
    from gap_controller import RACK_PITCH_MM, SLOT_COUNT

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
        self.gap_state = None
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

    def set_gap_state(self, state):
        self.gap_state = state
        self.update()

    def mousePressEvent(self, event):
        x = event.position().x()
        slot_width = self.width() / SLOT_COUNT
        positions = (self.gap_state or {}).get('racks', {})
        nearest = min(self.rack_ids, key=lambda rack: abs(
            x - (float(positions.get(rack, positions.get(str(rack), {})).get('position_mm', self.rack_ids.index(rack) * RACK_PITCH_MM)) / RACK_PITCH_MM + 0.5) * slot_width
        ))
        rack_position = float(positions.get(nearest, positions.get(str(nearest), {})).get('position_mm', self.rack_ids.index(nearest) * RACK_PITCH_MM)) / RACK_PITCH_MM
        if abs(x - (rack_position + 0.5) * slot_width) <= slot_width * 0.45:
            self.rackClicked.emit(nearest)

    def paintEvent(self, event):
        painter = QtGui.QPainter(self)
        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
        slot_width = self.width() / SLOT_COUNT
        gap_state = self.gap_state or {}
        rack_positions = gap_state.get('racks', {})
        positions = [rack_positions.get(rack, {}).get('position_mm', i * RACK_PITCH_MM)
                     for i, rack in enumerate(self.rack_ids)]
        # Render the actual free intervals, including distributed ventilation gaps.
        for left, right in zip(positions, positions[1:] + [SLOT_COUNT * RACK_PITCH_MM]):
            start = left + RACK_PITCH_MM
            width_mm = right - start
            if width_mm <= .1:
                continue
            gap_rect = QtCore.QRectF(start / RACK_PITCH_MM * slot_width + 1, 5,
                                    width_mm / RACK_PITCH_MM * slot_width - 2, self.height() - 10)
            painter.setPen(QtGui.QPen(QtGui.QColor('#168268'), 1, QtCore.Qt.PenStyle.DashLine))
            painter.setBrush(QtGui.QColor('#e7f5ef'))
            painter.drawRoundedRect(gap_rect, 4, 4)
            painter.setFont(QtGui.QFont('Segoe UI', 8))
            painter.drawText(gap_rect, QtCore.Qt.AlignmentFlag.AlignCenter,
                             'GAP' if width_mm > 50 else f'{width_mm:.0f}')
        active_rack = gap_state.get('active_rack')
        moving_rack = (gap_state.get('moving') or {}).get('rack_id')
        moving_direction = (gap_state.get('moving') or {}).get('direction')
        for i, rack in enumerate(self.rack_ids):
            fault = any(self.faults.get(rack, ()))
            selected = rack == self.selected
            rack_state = rack_positions.get(rack, rack_positions.get(str(rack), {}))
            moving = rack == moving_rack or bool(rack_state.get('is_moving'))
            status = 'FAULT' if fault else rack_state.get('access_state', 'CLOSED')
            light_on = gap_state.get('lights', {}).get(rack, False)
            position_px = float(rack_state.get('position_mm', i * RACK_PITCH_MM)) / RACK_PITCH_MM * slot_width
            color = COLORS['error' if fault or rack_state.get('movement_state') == 'ERROR' else
                           'active' if selected or moving else 'normal' if status in ('OPEN', 'VENTILATED') else 'muted']
            rect = QtCore.QRectF(position_px + 4, 3, slot_width - 8, self.height() - 6)
            painter.setPen(QtGui.QPen(QtGui.QColor(color), 2 if selected or fault or moving else 1))
            painter.setBrush(QtGui.QColor('#fff8df' if light_on else '#eaf2ff' if selected else '#f8fafc'))
            painter.drawRoundedRect(rect, 9, 9)
            painter.setPen(QtGui.QColor('#24354e'))
            font = painter.font()
            font.setBold(True)
            painter.setFont(font)
            painter.drawText(rect.adjusted(10, 7, -10, -rect.height() + 28),
                             QtCore.Qt.AlignmentFlag.AlignLeft, f'RACK {rack:02d}')
            if moving:
                painter.setPen(QtGui.QColor('#2563eb'))
                painter.drawText(rect.adjusted(8, 22, -8, -rect.height() + 40),
                                 QtCore.Qt.AlignmentFlag.AlignLeft, moving_direction or '')
            font.setBold(False)
            painter.setFont(font)
            body = rect.adjusted(12, 34, -12, -39)
            painter.setBrush(QtGui.QColor('#dde5ee'))
            painter.setPen(QtGui.QPen(QtGui.QColor('#a9b8ca'), 1))
            painter.drawRoundedRect(body, 4, 4)
            # Each door stays inside its own column, preserving all six racks at any width.
            gap = (0.32 if rack == active_rack else 0) * body.width()
            door = body.adjusted(gap, 0, 0, 0)
            painter.setBrush(QtGui.QColor('#ffffff' if selected else '#f0f4f8'))
            painter.drawRoundedRect(door, 4, 4)
            if i == 0:
                painter.drawRoundedRect(door.adjusted(8, 8, -8, -body.height() * .64), 2, 2)
            handle = QtCore.QRectF(door.center().x() - 13, body.bottom() - 13, 26, 4)
            painter.setBrush(QtGui.QColor('#667b93'))
            painter.drawRoundedRect(handle, 2, 2)
            painter.setPen(QtGui.QColor(color))
            painter.drawText(rect.adjusted(9, rect.height() - 34, -9, -16),
                             QtCore.Qt.AlignmentFlag.AlignCenter, status)
            painter.setPen(QtGui.QColor('#667b93'))
            painter.drawText(rect.adjusted(9, rect.height() - 18, -9, -1),
                             QtCore.Qt.AlignmentFlag.AlignCenter,
                             'LIGHT ON' if light_on else 'LIGHT OFF')


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
        for series, title, color in ((1, 'SPEED · mm/s', '#2563eb'), (2, 'DISPLACEMENT · mm', '#0f927c')):
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
