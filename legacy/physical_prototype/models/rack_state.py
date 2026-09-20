from collections import deque

class RackState:
    def __init__(self, rack_id):
        self.rack_id = rack_id

        # status
        self.position = 0
        self.error = 0

        # sensor
        self.temperature = 0
        self.humidity = 0
        self.gas = 0
        self.smoke = 0

        self.last_update = None
        self.history = deque(maxlen=50)