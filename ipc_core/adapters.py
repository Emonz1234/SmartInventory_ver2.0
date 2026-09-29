"""Existing wire formats, normalized to the same SerialMessage domain."""
import json


class SimulationAdapter:
    def encode(self, command):
        action = {"OPEN": 1, "CLOSE": 2, "VENTILATE": 3, "LIGHT": 0, "HOME": 4, "LIGHT_OFF": 5}[command["action"]]
        return f"0|{int(command['address'])}|{action}"

    def parse(self, raw):
        from ipc_core.app.serial.protocol.parser import ProtocolParser
        return ProtocolParser.parse(raw)


class HardwareAdapter:
    def encode(self, command):
        return json.dumps({"rack_id": int(command["address"]), "action": command["action"].lower()})

    def parse(self, raw):
        from ipc_core.app.serial.protocol.parser import ProtocolParser
        from ipc_core.app.serial.protocol.message import SerialMessage
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("Hardware message must be an object")
        if "type" in data:
            return ProtocolParser.parse(raw)
        return ProtocolParser.parse(json.dumps({"type": "telemetry", **data}))


def adapter_for(device_type):
    if device_type == "IPC":
        return HardwareAdapter()
    if device_type == "IPCSIM":
        return SimulationAdapter()
    raise ValueError("Unknown device type")
