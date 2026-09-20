"""Versioned, signed MQTT envelope. No broker credentials are carried in payloads."""
import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from uuid import uuid4

CHANNELS = {"sync", "command", "ack", "telemetry", "events", "status"}


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", value) is not None


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def checksum(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def envelope(device_id, device_type, message_type, payload, **metadata):
    return dict(protocol_version=1, message_id=str(uuid4()), device_id=device_id,
                device_type=device_type, message_type=message_type,
                timestamp=datetime.now(timezone.utc).isoformat(), payload=payload, **metadata)


def topic(device_id, direction, channel):
    if not valid_id(device_id) or direction not in {"up", "down"} or channel not in CHANNELS:
        raise ValueError("Invalid MQTT route")
    return f"inventory/v1/{device_id}/{direction}/{channel}"


def validate(route, message, device_id, device_type, direction):
    parts = route.split("/")
    if len(parts) != 5 or route != topic(device_id, direction, parts[-1]):
        raise ValueError("Topic identity mismatch")
    if message.get("protocol_version") != 1:
        raise ValueError("Unsupported protocol version")
    if message.get("device_id") != device_id or message.get("device_type") != device_type:
        raise ValueError("Registry identity mismatch")
    if not isinstance(message.get("payload"), dict) or not message.get("message_id"):
        raise ValueError("Malformed envelope")
    stamp = datetime.fromisoformat(message["timestamp"])
    if stamp.tzinfo is None:
        raise ValueError("Timestamp requires timezone")
    kind = message.get("message_type", "").split(".")[0]
    if kind != parts[-1]:
        raise ValueError("Message channel mismatch")


def encode(message, secret):
    if len(secret) < 32:
        raise ValueError("DEVICE_SECRET must contain at least 32 characters")
    signature = hmac.new(secret.encode(), canonical(message).encode(), hashlib.sha256).hexdigest()
    return canonical({"message": message, "signature": signature})


def decode(raw, secret):
    if len(raw) > 2_000_000 or len(secret) < 32:
        raise ValueError("Invalid packet size or secret")
    packet = json.loads(raw)
    message = packet["message"]
    expected = hmac.new(secret.encode(), canonical(message).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, packet.get("signature", "")):
        raise ValueError("Invalid message signature")
    return message
