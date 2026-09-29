"""Logical six-rack mobile-rack state and sequential gap movement."""
from collections import deque
from dataclasses import asdict, dataclass
import math


RACK_COUNT = 6
SLOT_COUNT = 7
RACK_PITCH_MM = 100
MOVE_DISTANCE_MM = 100
MIN_POSITION_MM = 0
MAX_POSITION_MM = 600
SLOW_SPEED_MM_S = 20
NORMAL_SPEED_MM_S = 25
FAST_SPEED_MM_S = 33
DEFAULT_SPEED_MM_S = NORMAL_SPEED_MM_S
VENTILATION_GAP_MM = MOVE_DISTANCE_MM / (RACK_COUNT - 1)
VALID_ACTIONS = {0, 1, 2, 3, 4, 5}
ACTION_NAMES = {0: 'LIGHT', 1: 'OPEN', 2: 'CLOSE', 3: 'VENTILATE', 4: 'HOME', 5: 'LIGHT_OFF'}


@dataclass
class RackState:
    rack_id: int
    order: int
    slot: float
    position_mm: float
    home_position_mm: float
    target_position_mm: float
    start_position_mm: float
    displacement_mm: float = 0.0
    speed_mm_s: float = 0.0
    duration_s: float = 0.0
    progress_percent: float = 0.0
    movement_state: str = 'IDLE'
    direction: str | None = None
    is_moving: bool = False


class GapMovementController:
    """Sequential access-gap and evenly spaced cabinet ventilation movement."""

    def __init__(self, rack_ids, speed_mm_s=DEFAULT_SPEED_MM_S):
        rack_ids = tuple(rack_ids)
        if len(rack_ids) != RACK_COUNT or len(set(rack_ids)) != RACK_COUNT:
            raise ValueError('A group must contain exactly six unique racks')
        self.rack_ids = rack_ids
        self.rack_order = {rack_id: order for order, rack_id in enumerate(rack_ids, 1)}
        if not math.isfinite(speed_mm_s) or speed_mm_s <= 0:
            raise ValueError('Speed must be positive and finite in mm/s')
        self.speed_mm_s = speed_mm_s
        self.reset()

    def reset(self):
        self.current_gap = RACK_COUNT
        self.gap_position = float(RACK_COUNT)
        self.active_rack = None
        self.system_state = 'IDLE'
        self.pending_commands = deque()
        self.current_command = None
        self.movement_steps = deque()
        self.current_step = None
        self.step_progress = 0.0
        self.last_error = None
        self.racks = {
            rack_id: RackState(
                rack_id=rack_id, order=order, slot=order - 1,
                position_mm=(order - 1) * RACK_PITCH_MM,
                home_position_mm=(order - 1) * RACK_PITCH_MM,
                target_position_mm=(order - 1) * RACK_PITCH_MM,
                start_position_mm=(order - 1) * RACK_PITCH_MM,
            )
            for order, rack_id in enumerate(self.rack_ids, 1)
        }

    def enqueue(self, rack_id, action):
        if type(rack_id) is not int or rack_id not in self.rack_order:
            raise ValueError('Rack ID is outside this six-rack group')
        if type(action) is not int or action not in VALID_ACTIONS:
            raise ValueError('Unsupported simulation action')
        if self.system_state == 'ERROR':
            raise ValueError('Simulation is in ERROR state; clear the fault before sending commands')
        command = (rack_id, action)
        # Only adjacent retries are duplicates: OPEN, CLOSE, OPEN is valid FIFO.
        last_command = (self.pending_commands[-1] if self.pending_commands else
                        self.current_command[:2] if self.current_command else None)
        if command == last_command:
            return False
        self.pending_commands.append(command)
        return True

    def move_gap_to(self, target_gap):
        if type(target_gap) is not int or not 1 <= target_gap <= RACK_COUNT:
            raise ValueError('Target gap must be between 1 and 6')
        if self.current_step is not None:
            raise RuntimeError('Cannot replan the gap while a rack is moving')

        if self.current_gap is None:
            targets = {rack_id: (order - 1 + (order > target_gap)) * RACK_PITCH_MM
                       for rack_id, order in self.rack_order.items()}
            return self._plan_positions(targets, target_gap)

        steps = []
        if target_gap > self.current_gap:
            for order in range(self.current_gap + 1, target_gap + 1):
                steps.append({
                    'rack_id': self.rack_ids[order - 1],
                    'direction': 'LEFT',
                    'from_position_mm': order * RACK_PITCH_MM,
                    'to_position_mm': (order - 1) * RACK_PITCH_MM,
                    'next_gap': order,
                })
        elif target_gap < self.current_gap:
            for order in range(self.current_gap, target_gap, -1):
                steps.append({
                    'rack_id': self.rack_ids[order - 1],
                    'direction': 'RIGHT',
                    'from_position_mm': (order - 1) * RACK_PITCH_MM,
                    'to_position_mm': order * RACK_PITCH_MM,
                    'next_gap': order - 1,
                })
        self.movement_steps = deque(steps)
        return len(steps)

    def _plan_positions(self, targets, final_gap):
        # Move left from left to right, then right from right to left so that
        # every destination has enough free space before its rack moves.
        steps = []
        for direction, rack_ids in (('LEFT', self.rack_ids), ('RIGHT', reversed(self.rack_ids))):
            for rack_id in rack_ids:
                origin = self.racks[rack_id].position_mm
                target = targets[rack_id]
                delta = target - origin
                if (direction == 'LEFT' and delta < -1e-8) or (direction == 'RIGHT' and delta > 1e-8):
                    steps.append({'rack_id': rack_id, 'direction': direction,
                                  'from_position_mm': origin, 'to_position_mm': target,
                                  'next_gap': None})
        if steps:
            steps[-1]['next_gap'] = final_gap
        self.movement_steps = deque(steps)
        return len(steps)

    def advance(self, elapsed, blocked_racks=(), speed=None):
        """Advance the active rack animation and return state transition events."""
        if self.system_state == 'ERROR':
            return []

        events = []
        if self.current_command is None and self.pending_commands:
            events.extend(self._start_next_command())
        if self.current_command is None:
            return events
        if self.current_command[1] == 3 and blocked_racks:
            return events + [self._fail_movement(next(iter(blocked_racks)), 'Active hardware breakdown')]

        if self.current_step is None:
            if not self.movement_steps:
                events.append(self._complete_command())
                return events
            self.current_step = self.movement_steps.popleft()
            moving_rack = self.current_step['rack_id']
            if moving_rack in blocked_racks:
                return events + [self._fail_movement(moving_rack, 'Active hardware breakdown')]
            rack = self.racks[moving_rack]
            step_speed = self.speed_mm_s if speed is None else speed
            if not math.isfinite(step_speed) or step_speed <= 0:
                raise ValueError('Speed must be positive and finite in mm/s')
            rack.start_position_mm = rack.position_mm
            rack.target_position_mm = self.current_step['to_position_mm']
            rack.displacement_mm = 0.0
            rack.progress_percent = 0.0
            rack.speed_mm_s = step_speed
            rack.duration_s = abs(rack.target_position_mm - rack.position_mm) / step_speed
            rack.direction = self.current_step['direction']
            rack.movement_state = f"MOVING_{rack.direction}"
            rack.is_moving = True
            self.step_progress = 0.0
            events.append({
                'type': 'step_started',
                **self.current_step,
                'current_gap': self.current_gap,
            })
            return events

        if elapsed <= 0:
            return events
        moving_rack = self.current_step['rack_id']
        if moving_rack in blocked_racks:
            return [self._fail_movement(moving_rack, 'Active hardware breakdown')]

        rack = self.racks[moving_rack]
        origin = rack.start_position_mm
        target = rack.target_position_mm
        distance = abs(target - origin)
        self.step_progress = min(distance, self.step_progress + rack.speed_mm_s * elapsed)
        fraction = self.step_progress / distance
        rack.position_mm = origin + (target - origin) * fraction
        rack.displacement_mm = self.step_progress
        rack.progress_percent = fraction * 100
        self.gap_position = (self.current_gap + (self.current_step['next_gap'] - self.current_gap) * fraction
                             if self.current_gap is not None and self.current_step['next_gap'] is not None else None)

        if self.step_progress >= distance:
            rack.position_mm = target
            rack.slot = target / RACK_PITCH_MM
            rack.speed_mm_s = 0.0
            rack.movement_state = 'IDLE'
            rack.direction = None
            rack.is_moving = False
            self.current_gap = self.current_step['next_gap']
            self.gap_position = float(self.current_gap) if self.current_gap is not None else None
            completed_step = self.current_step
            self.current_step = None
            self.step_progress = 0.0
            self._assert_invariants()
            events.append({
                'type': 'step_completed',
                **completed_step,
                'current_gap': self.current_gap,
            })
        else:
            events.append({
                'type': 'step_progress',
                **self.current_step,
                'progress': self.step_progress,
                'current_gap': self.current_gap,
            })
        return events

    def recover(self):
        if self.system_state != 'ERROR':
            return False
        self.system_state = 'OPEN' if self.active_rack is not None else 'IDLE'
        self.last_error = None
        for rack in self.racks.values():
            if rack.movement_state == 'ERROR':
                rack.movement_state = 'IDLE'
                rack.direction = None
                rack.is_moving = False
                rack.target_position_mm = rack.position_mm
        self._assert_invariants()
        return True

    def snapshot(self):
        command = None
        if self.current_command is not None:
            rack_id, action, target_gap = self.current_command
            command = {'rack_id': rack_id, 'action': ACTION_NAMES[action], 'target_gap': target_gap}
        moving = None
        if self.current_step is not None:
            moving = {
                'rack_id': self.current_step['rack_id'],
                'direction': self.current_step['direction'],
                'progress': self.step_progress,
            }
        return {
            'current_gap': self.current_gap,
            'gap_position': self.gap_position,
            'active_rack': self.active_rack,
            'system_state': self.system_state,
            'current_command': command,
            'moving': moving,
            'pending_commands': [
                {'rack_id': rack_id, 'action': ACTION_NAMES[action]}
                for rack_id, action in self.pending_commands
            ],
            'last_error': self.last_error,
            'racks': {rack_id: {**asdict(state), 'access_state': (
                'ERROR' if state.movement_state == 'ERROR' else
                'MOVING' if state.is_moving else
                'VENTILATING' if self.system_state == 'VENTILATING' else
                'VENTILATED' if self.system_state == 'VENTILATED' else
                'OPEN' if rack_id == self.active_rack else 'CLOSED')}
                for rack_id, state in self.racks.items()},
        }

    def _start_next_command(self):
        rack_id, action = self.pending_commands.popleft()
        order = self.rack_order[rack_id]
        target_gap = self.current_gap
        if action == 1:
            target_gap = 1 if order == 1 else order - 1
        elif action == 3:
            target_gap = None
        elif action == 2:
            if self.system_state == 'VENTILATED':
                target_gap = RACK_COUNT
            elif self.active_rack != rack_id:
                return [{
                    'type': 'command_rejected', 'rack_id': rack_id, 'action': action,
                    'current_gap': self.current_gap, 'reason': 'Rack is not the active access point',
                }]
            else:
                target_gap = self.current_gap + 1 if self.current_gap < RACK_COUNT else self.current_gap - 1
        elif action == 4:
            target_gap = RACK_COUNT

        self.current_command = (rack_id, action, target_gap)
        if action == 4:
            self.system_state = 'RETURNING_HOME'
        elif action == 3:
            self.system_state = 'VENTILATING'
        elif action not in (0, 5):
            self.system_state = 'MOVING'
        if action == 3:
            targets = {rack_id: (order - 1) * (RACK_PITCH_MM + VENTILATION_GAP_MM)
                       for rack_id, order in self.rack_order.items()}
            self._plan_positions(targets, None)
            self.current_gap = self.gap_position = None
            self.active_rack = None
        elif action in (0, 5):
            self.movement_steps.clear()
        else:
            self.move_gap_to(target_gap)
        return [{
            'type': 'command_started', 'rack_id': rack_id, 'action': action,
            'current_gap': self.current_gap, 'target_gap': target_gap,
            'movement_count': len(self.movement_steps),
        }]

    def _complete_command(self):
        rack_id, action, target_gap = self.current_command
        if action == 1:
            self.active_rack = rack_id
            self.system_state = 'OPEN'
        elif action == 3:
            self.active_rack = None
            self.system_state = 'VENTILATED'
        elif action in (2, 4):
            self.active_rack = None
            self.system_state = 'IDLE'
        if action not in (0, 5):
            self.current_gap = target_gap
            self.gap_position = float(target_gap) if target_gap is not None else None
        self.current_command = None
        self._assert_invariants()
        return {
            'type': 'command_completed', 'rack_id': rack_id, 'action': action,
            'current_gap': self.current_gap, 'target_gap': target_gap,
        }

    def _fail_movement(self, rack_id, reason):
        for moving in self.racks.values():
            if moving.is_moving:
                moving.is_moving = False
                moving.speed_mm_s = 0.0
                moving.direction = None
                moving.movement_state = 'ERROR'
                moving.target_position_mm = moving.position_mm
        rack = self.racks[rack_id]
        rack.movement_state = 'ERROR'
        rack.is_moving = False
        rack.direction = None
        rack.target_position_mm = rack.position_mm
        rack.speed_mm_s = 0.0
        command = self.current_command
        self.current_step = None
        self.movement_steps.clear()
        self.pending_commands.clear()
        self.current_command = None
        self.system_state = 'ERROR'
        self.last_error = reason
        self._assert_invariants()
        return {
            'type': 'movement_error',
            'rack_id': rack_id,
            'command_rack_id': command[0] if command else None,
            'current_gap': self.current_gap,
            'reason': reason,
        }

    def _assert_invariants(self):
        if len(self.racks) != RACK_COUNT or (self.current_gap is not None and not 1 <= self.current_gap <= RACK_COUNT):
            raise RuntimeError('Invalid six-rack topology or gap position')
        positions = [self.racks[rack_id].position_mm for rack_id in self.rack_ids]
        if any(not MIN_POSITION_MM <= position <= MAX_POSITION_MM for position in positions):
            raise RuntimeError('Rack moved outside the rail')
        if any(right - left < RACK_PITCH_MM - 1e-8 for left, right in zip(positions, positions[1:])):
            raise RuntimeError('Rack order invariant violated')
