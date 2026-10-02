"""Explicit location identity; database PKs and Serial addresses are not display indices."""
from .permissions import source


def location_fields(rack):
    cabinet = rack.cabinet
    return dict(device_code=cabinet.device_id, device_type=source(cabinet.domain),
                cabinet_code=cabinet.code, cabinet_index=cabinet.cabinet_index,
                rack_code=rack.code, rack_index=rack.rack_index,
                serial_address=rack.address)
