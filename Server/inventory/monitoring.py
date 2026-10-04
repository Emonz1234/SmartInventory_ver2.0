"""Projection of authenticated MQTT samples; absent fields never clear an alarm."""

import math
from django.utils.dateparse import parse_datetime
from .models import Rack, RackStatus, EnvironmentStatus, Alarm, SystemSetting
from .permissions import source

FIELDS = {
    "temperature",
    "humidity",
    "weight",
    "smoke",
    "gas",
    "gas_alert",
    "state",
    "speed",
    "movement_speed",
    "displacement",
    "is_hard_locked",
    "is_endpoint",
    "is_obstructed",
    "is_overload_motor",
    "is_skewed",
}


def ingest(device, payload, timestamp):
    rack = Rack.objects.filter(
        cabinet__device=device, address=payload.get("rack_id")
    ).first()
    if rack is None:
        return
    at = parse_datetime(timestamp)
    values = {
        k: v
        for k, v in payload.items()
        if k in FIELDS and isinstance(v, (int, float)) and math.isfinite(v)
    }
    if not values:
        return
    current, _ = RackStatus.objects.get_or_create(
        rack=rack, defaults={"updated_at": at}
    )
    if any(k in values for k in ("temperature", "humidity", "weight", "smoke", "gas", "gas_alert")):
        EnvironmentStatus.objects.create(
            rack=rack,
            device=device,
            source_type=source(device.device_type),
            values=values,
            created_at=at,
        )
    if at < current.updated_at:
        return
    current.values = {**current.values, **values}
    current.updated_at = at
    current.save()
    settings = dict(SystemSetting.objects.values_list("key", "value"))
    rules = {
        "smoke": ("critical", 0),
        "is_obstructed": ("critical", 0),
        "is_overload_motor": ("critical", 0),
        "is_skewed": ("critical", 0),
        "temperature": ("warning", settings.get("temperature_max", 50)),
        "humidity": ("warning", settings.get("humidity_max", 85)),
    }
    for key, (severity, threshold) in rules.items():
        if key not in values:
            continue
        active = Alarm.objects.filter(rack=rack, code=key, active=True)
        if values[key] > threshold:
            if not active.exists():
                Alarm.objects.create(
                    rack=rack,
                    device=device,
                    source_type=source(device.device_type),
                    code=key,
                    severity=severity,
                    created_at=at,
                )
        else:
            active.update(active=False, cleared_at=at)
