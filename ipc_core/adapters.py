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
    """ESP32 newline commands/state plus backward compatible JSON telemetry."""
    supports_commands = True

    def encode(self, command):
        action = command['action']
        if action == 'PING':
            return 'PING'
        if action not in {'OPEN', 'CLOSE', 'STOP', 'STATUS', 'RESET'}:
            raise ValueError(f'ESP32 does not support {action}')
        address = command['address']
        if type(address) is not int or not 1 <= address <= 65535:
            raise ValueError('Invalid Serial rack address')
        return f'{action} {address}'

    def parse(self, raw):
        from ipc_core.app.serial.protocol.parser import ProtocolParser
        from ipc_core.app.serial.protocol.message import SerialMessage
        raw = raw.strip()
        if raw in {"START SYSTEM", "DHT ERROR"}:
            return SerialMessage(msg_type="diagnostic", payload={"raw": raw})
        if not raw.startswith('{'):
            return self.parse_text(raw)
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

    def parse_text(self, raw):
        from ipc_core.app.serial.protocol.message import SerialMessage
        parts = raw.split()
        if parts == ['PONG']:
            return SerialMessage(msg_type='ack', payload={'command': 'PING'})
        if len(parts) == 3 and parts[0] == 'ACK' and parts[1] in {'OPEN','CLOSE','STOP','RESET','STATUS'}:
            address = int(parts[2])
            if not 1 <= address <= 65535:
                raise ValueError('Invalid ACK address')
            return SerialMessage(msg_type='ack', payload={'command': parts[1], 'rack_id': address})
        if len(parts) == 3 and parts[0] == 'ERROR':
            address = int(parts[1])
            if not 0 <= address <= 65535:
                raise ValueError('Invalid error address')
            return SerialMessage(msg_type='event', payload={'rack_id': address, 'hardware_error': parts[2], 'is_obstructed': 1})
        if parts and parts[0] in {'STATE','STATUS'} and len(parts) == (3 if parts[0] == 'STATE' else 6):
            address, state = int(parts[1]), parts[2]
            if not 1 <= address <= 65535 or state not in {'UNKNOWN','CLOSED','OPENING','OPENED','CLOSING','STOPPED','ERROR'}:
                raise ValueError('Invalid rack state')
            payload = {'rack_id': address, 'hardware_state': state,
                       'hardware_frame': parts[0],
                       'state': {'OPENING':1,'CLOSING':2,'OPENED':-1,'CLOSED':-1}.get(state,0),
                       'movement_speed': int(state in {'OPENING','CLOSING'}),
                       'is_endpoint': int(state in {'OPENED','CLOSED'}),
                       'is_hard_locked': 0, 'is_obstructed': int(state == 'ERROR')}
            if state in {'OPENED','CLOSED'}:
                # Logical endpoint marker, not a measured travel distance.
                payload['displacement'] = 1 if state == 'OPENED' else 0
            if parts[0] == 'STATUS':
                opened, closed, gas = map(int, parts[3:])
                if opened not in (0,1) or closed not in (0,1) or not 0 <= gas <= 4095:
                    raise ValueError('Invalid STATUS sensors')
                if (state == 'OPENED' and (opened,closed) != (1,0)) or (state == 'CLOSED' and (opened,closed) != (0,1)):
                    raise ValueError('STATUS endpoint contradicts limits')
                payload.update(open_limit=opened, close_limit=closed, gas=gas)
            return SerialMessage(msg_type='event', payload=payload)
        raise ValueError('Invalid ESP32 frame')


def adapter_for(device_type):
    if device_type == "IPC":
        return HardwareAdapter()
    if device_type == "IPCSIM":
        return SimulationAdapter()
    raise ValueError("Unknown device type")
