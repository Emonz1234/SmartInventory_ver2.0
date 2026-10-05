"""Existing wire formats, normalized to the same SerialMessage domain."""
import json
import math


class SimulationAdapter:
    supports_commands = True
    def encode(self, command):
        action = {"OPEN": 1, "CLOSE": 2, "VENTILATE": 3, "LIGHT": 0, "HOME": 4, "LIGHT_OFF": 5}[command["action"]]
        return f"0|{int(command['address'])}|{action}"

    def parse(self, raw):
        from ipc_core.app.serial.protocol.parser import ProtocolParser
        if raw.startswith('SIMSTT|'):
            import base64
            import zlib
            decoder = zlib.decompressobj()
            data = decoder.decompress(base64.b64decode(raw.split('|', 1)[1], validate=True), 65537)
            if len(data) > 65536 or decoder.unconsumed_tail or not decoder.eof:
                raise ValueError('Invalid or oversized Simulation snapshot')
            raw = data.decode('utf-8')
        return ProtocolParser.parse(raw)


class HardwareAdapter:
    """USB Serial telemetry emitted by esp32_master_serial/src/main.cpp."""
    supports_commands = False

    def encode(self, command):
        raise NotImplementedError("Current ESP32 firmware only emits telemetry; it has no command receiver or ACK")

    def parse(self, raw):
        from ipc_core.app.serial.protocol.parser import ProtocolParser
        from ipc_core.app.serial.protocol.message import SerialMessage
        raw = raw.strip()
        if raw in {"START SYSTEM", "DHT ERROR"}:
            return SerialMessage(msg_type="diagnostic", payload={"raw": raw})
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Hardware message must be an object")
        if data.get("type", "telemetry") != "telemetry":
            raise ValueError("Current ESP32 firmware supports telemetry only")
        address = data.get("rack_id")
        if isinstance(address, bool) or not isinstance(address, int) or address < 1:
            raise ValueError("ESP32 rack_id must be a positive integer Serial address")
        for key in ("temperature", "humidity", "gas"):
            if key in data and (isinstance(data[key], bool) or not isinstance(data[key], (int, float)) or not math.isfinite(data[key])):
                raise ValueError(f"ESP32 {key} must be a finite number")
        if "gas" in data and not 0 <= data["gas"] <= 4095:
            raise ValueError("ESP32 gas must be a raw 12-bit ADC value (0..4095)")
        if "gas_alert" in data:
            if not isinstance(data["gas_alert"], bool):
                raise ValueError("ESP32 gas_alert must be a boolean")
            # Use the firmware alarm decision, not truthiness of the ADC reading.
            data["smoke"] = int(data["gas_alert"])
        return ProtocolParser.parse(json.dumps({"type": "telemetry", **data}))


def adapter_for(device_type):
    if device_type == "IPC":
        return HardwareAdapter()
    if device_type == "IPCSIM":
        return SimulationAdapter()
    raise ValueError("Unknown device type")
