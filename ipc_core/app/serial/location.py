"""Diagnostic labels distinguish local position, transport address and database FK."""


def describe_location(payload):
    return (f"device={payload.get('device_code') or '?'} "
            f"cabinet_index={payload.get('cabinet_index')} rack_index={payload.get('rack_index')} "
            f"serial_address={payload.get('serial_address')} db_rack_id={payload.get('rack_id')}")
