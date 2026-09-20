import serial
import json
import threading
import sys
from pathlib import Path

# Add parent directory to path for imports
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from config import SERIAL_PORT, SERIAL_BAUD
from services.rack_manager import RackManager


class ESP32SerialClient:
    def __init__(self):
        self.rack_manager = RackManager()
        self.serial_conn = None
        self.running = False

    # ===== CONNECT SERIAL =====
    def connect(self):
        print("[SERIAL] Connecting to serial port...")

        try:
            self.serial_conn = serial.Serial(
                SERIAL_PORT,
                SERIAL_BAUD,
                timeout=1
            )
            self.running = True
            print(f"[SERIAL] Connected OK - {SERIAL_PORT}@{SERIAL_BAUD}")

            thread = threading.Thread(target=self.read_loop, daemon=True)
            thread.start()
        except Exception as e:
            print(f"[ERROR] Failed to connect: {e}")
            raise

    # ===== READ LOOP =====
    def read_loop(self):
        while self.running:
            try:
                if not self.serial_conn or not self.serial_conn.is_open:
                    break

                line = self.serial_conn.readline()
                
                if not line:
                    continue
                
                try:
                    line = line.decode().strip()
                except UnicodeDecodeError:
                    print(f"[ERROR] Failed to decode serial data")
                    continue

                if not line:
                    continue

                print(f"[RECV] {line}")

                data = json.loads(line)

                rack_id = str(data.get("rack_id", 1))

                self.rack_manager.update_sensor(rack_id, data)

                self.handle_sensor_logic(rack_id, data)

            except json.JSONDecodeError as e:
                print(f"[ERROR] Invalid JSON received: {line} - {e}")
            except Exception as e:
                print(f"[ERROR] Read error: {e}")

    # ===== SENSOR LOGIC =====
    def handle_sensor_logic(self, rack_id, data):
        gas = data.get("gas", 0)
        temp = data.get("temperature", 0)

        if gas > 2000:
            print(f"🔥 GAS ALERT tại rack {rack_id}")

        if temp > 50:
            print(f"🌡️ HIGH TEMP tại rack {rack_id}")

    # ===== SEND COMMAND =====
    def send_command(self, rack_id, action):
        if not self.serial_conn or not self.serial_conn.is_open:
            print("[ERROR] Serial connection not open")
            return

        payload = {
            "rack_id": rack_id,
            "action": action
        }

        message = json.dumps(payload)

        try:
            self.serial_conn.write((message + "\n").encode())
            print(f"[SEND] {message}")
        except Exception as e:
            print(f"[ERROR] Failed to send command: {e}")

    # ===== DISCONNECT =====
    def disconnect(self):
        self.running = False
        if self.serial_conn and self.serial_conn.is_open:
            self.serial_conn.close()
            print("[SERIAL] Disconnected")
