import json

from .message import SerialMessage


def normalize_smoke_value(value):
    if value is None or value == "":
        return None

    if isinstance(value, bool):
        return int(value)

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return 1 if value != 0 else 0

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "có", "co", "alert", "detected", "on"}:
            return 1
        if normalized in {"0", "false", "no", "không", "khong", "ok", "safe", "off", "none"}:
            return 0

        try:
            return int(float(normalized))
        except (TypeError, ValueError):
            return None

    return None


class ProtocolParser:

    @staticmethod
    def parse(raw: str) -> SerialMessage:

        raw = raw.strip()

        if not raw:
            return SerialMessage(msg_type="unknown", payload={"raw": raw})

        if raw.startswith("{"):
            try:
                data = json.loads(raw)
                msg_type = data.pop("type", "unknown")
                payload = dict(data)
                if "smoke" in payload:
                    payload["smoke"] = normalize_smoke_value(payload["smoke"])
                if "smoke_detected" in payload:
                    payload["smoke_detected"] = normalize_smoke_value(payload["smoke_detected"])
                return SerialMessage(msg_type=msg_type, payload=payload)
            except json.JSONDecodeError:
                return ProtocolParser._parse_legacy(raw)

        return ProtocolParser._parse_legacy(raw)

    @staticmethod
    def _parse_legacy(raw: str) -> SerialMessage:

        parts = raw.split("|")

        if parts[0] == "ENVSTT" and len(parts) >= 6:
            return SerialMessage(
                msg_type="telemetry",
                payload={
                    "rack_id": int(parts[1]),
                    "temperature": float(parts[2]),
                    "humidity": float(parts[3]),
                    "weight": float(parts[4]),
                    "smoke": normalize_smoke_value(parts[5])
                }
            )

        if parts[0] == "OPRSTT" and len(parts) >= 6:
            return SerialMessage(
                msg_type="event",
                payload={
                    "rack_id": int(parts[1]),
                    "movement_speed": float(parts[2]),
                    "displacement": float(parts[3]),
                    "is_hard_locked": int(parts[4]),
                    "is_endpoint": int(parts[5]),
                    "state": int(parts[6]) if len(parts) > 6 else None
                }
            )

        if parts[0] == "BRKSTT" and len(parts) >= 5:
            return SerialMessage(
                msg_type="event",
                payload={
                    "rack_id": int(parts[1]),
                    "is_obstructed": int(parts[2]),
                    "is_skewed": int(parts[3]),
                    "is_overload_motor": int(parts[4])
                }
            )

        if parts[0] == "ACK":
            return SerialMessage(msg_type="ack", payload={"values": parts[1:]})

        return SerialMessage(msg_type="unknown", payload={"raw": raw})
