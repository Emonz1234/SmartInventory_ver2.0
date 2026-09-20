from datetime import timedelta
from typing import Dict

from fastapi import APIRouter, Request
from fastapi import Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ipc_core.app.database.database import get_db
from ipc_core.app.database.models.environment import EnvironmentSnapshot
from ipc_core.app.database.models.inventory import Cabinet
from ipc_core.app.database.models.inventory import Item
from ipc_core.app.database.models.inventory import ItemLocation
from ipc_core.app.database.models.inventory import Rack
from ipc_core.app.database.models.runtime import BreakdownSnapshot
from ipc_core.app.database.models.runtime import OperationSnapshot
from ipc_core.app.serial import serial_manager
from ipc_core.app.core.config import settings
from ipc_core.app.serial.protocol.parser import normalize_smoke_value
from ipc_core.app.utils.timezone import format_datetime, get_current_time, to_vietnam_timezone

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])
TELEMETRY_ACTIVE_TIMEOUT = timedelta(seconds=15)


def get_environment_summary(db: Session):
    latest = db.query(EnvironmentSnapshot).order_by(EnvironmentSnapshot.id.desc()).first()
    if latest is None:
        return {
            "temperature": None,
            "humidity": None,
            "weight": None,
            "smoke_detected": None,
            "last_updated": None
        }
    smoke_value = normalize_smoke_value(latest.smoke_detected)
    return {
        "temperature": latest.temperature,
        "humidity": latest.humidity,
        "weight": latest.weight,
        "smoke_detected": smoke_value,
        "smoke": smoke_value,
        "last_updated": format_datetime(latest.created_at) if latest.created_at else None
    }


@router.get("/summary")
def get_dashboard_summary(request: Request, db: Session = Depends(get_db)) -> Dict[str, object]:
    cabinet_count = db.query(func.count(Cabinet.id)).scalar() or 0
    rack_count = db.query(func.count(Rack.id)).scalar() or 0
    environment_count = db.query(func.count(EnvironmentSnapshot.id)).scalar() or 0
    operation_count = db.query(func.count(OperationSnapshot.id)).scalar() or 0
    breakdown_count = db.query(func.count(BreakdownSnapshot.id)).scalar() or 0

    total_items = db.query(func.count(Item.id)).scalar() or 0
    total_stock = db.query(func.coalesce(func.sum(ItemLocation.quantity), 0)).scalar() or 0

    stock_subq = (
        db.query(
            ItemLocation.item_id.label("item_id"),
            func.coalesce(func.sum(ItemLocation.quantity), 0).label("quantity")
        )
        .group_by(ItemLocation.item_id)
        .subquery()
    )

    low_stock_count = (
        db.query(func.count(Item.id))
        .outerjoin(stock_subq, Item.id == stock_subq.c.item_id)
        .filter(func.coalesce(stock_subq.c.quantity, 0) < Item.min_qty)
        .scalar()
    ) or 0

    connected = (
        serial_manager.serial is not None
        and serial_manager.serial.is_open
    )
    active_since = get_current_time() - TELEMETRY_ACTIVE_TIMEOUT
    active_cabinets = []
    for cabinet in db.query(Cabinet).all():
        latest_telemetry = db.query(func.max(EnvironmentSnapshot.created_at)).join(
            Rack, Rack.id == EnvironmentSnapshot.rack_id
        ).filter(Rack.cabinet_id == cabinet.id).scalar()
        if latest_telemetry is not None:
            latest_telemetry = to_vietnam_timezone(latest_telemetry)
        if latest_telemetry is not None and latest_telemetry >= active_since:
            active_cabinets.append({
                "id": cabinet.id,
                "name": cabinet.cabinet_name or cabinet.cabinet_code,
                "code": cabinet.cabinet_code,
                "last_telemetry": format_datetime(latest_telemetry)
            })

    return {
        "system_status": {
            "serial_connected": connected,
            "simulation_online": connected and settings.DEVICE_TYPE == 'IPCSIM',
            "database_healthy": True,
            "server_synced": request.app.state.runtime.synced
        },
        "inventory_summary": {
            "total_items": total_items,
            "total_stock": total_stock,
            "low_stock_count": low_stock_count
        },
        "cabinet_status": {
            "total_cabinets": cabinet_count,
            "total_racks": rack_count,
            "active_cabinets": len(active_cabinets),
            "inactive_cabinets": cabinet_count - len(active_cabinets),
            "active_racks": sum(
                db.query(func.count(Rack.id)).filter(Rack.cabinet_id == cabinet["id"]).scalar() or 0
                for cabinet in active_cabinets
            ),
            "active_groups": active_cabinets
        },
        "environment_summary": get_environment_summary(db)
    }
