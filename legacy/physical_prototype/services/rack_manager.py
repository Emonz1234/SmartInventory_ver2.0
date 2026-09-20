from models.rack_state import RackState
from datetime import datetime

class RackManager:
    def __init__(self):
        self.racks = {}

    def get_or_create(self, rack_id):
        if rack_id not in self.racks:
            self.racks[rack_id] = RackState(rack_id)
        return self.racks[rack_id]

    # ===== STATUS =====
    def update_status(self, rack_id, data):
        rack = self.get_or_create(rack_id)

        rack.position = data.get("pos", rack.position)
        rack.error = data.get("error", rack.error)
        rack.last_update = datetime.now()

        print(f"[STATUS] Rack {rack_id}: {data}")

    # ===== SENSOR =====
    def update_sensor(self, rack_id, data):
        rack = self.get_or_create(rack_id)

        rack.temperature = float(data.get("temperature", rack.temperature))
        rack.humidity = float(data.get("humidity", rack.humidity))
        rack.gas = float(data.get("gas", rack.gas))
        rack.smoke = float(data.get("smoke", rack.smoke))
        rack.last_update = datetime.now()

        timestamp = datetime.now().strftime("%H:%M:%S")

        rack.history.append({
            "time": timestamp,
            "temperature": rack.temperature,
            "humidity": rack.humidity,
            "gas": rack.gas
        })

        print(f"[SENSOR] Rack {rack_id}: {data}")