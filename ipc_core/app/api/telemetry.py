from datetime import timedelta

from fastapi import APIRouter
from fastapi import Depends
from sqlalchemy.orm import Session
from ipc_core.app.database.database import get_db
from ipc_core.app.database.models.environment import EnvironmentSnapshot
from ipc_core.app.database.models.runtime import OperationSnapshot, BreakdownSnapshot
from ipc_core.app.serial.protocol.parser import normalize_smoke_value
from ipc_core.app.utils.timezone import get_current_time, format_datetime

router = APIRouter(prefix="/api", tags=["telemetry"])


def format_environment_snapshot(d: EnvironmentSnapshot):
    smoke_value = normalize_smoke_value(getattr(d, "smoke_detected", None))
    return {
        "id": d.id,
        "rack_id": d.rack_id,
        "temperature": d.temperature,
        "humidity": d.humidity,
        "weight": d.weight,
        "gas": d.gas,
        "smoke": smoke_value,
        "smoke_detected": smoke_value,
        "created_at": format_datetime(d.created_at) if d.created_at else None
    }


@router.get("/environment")
@router.get("/telemetry/environment")
def get_environment_data(limit: int = 100, db: Session = Depends(get_db)):
    data = db.query(EnvironmentSnapshot).order_by(
        EnvironmentSnapshot.id.desc()
    ).limit(limit).all()
    return {
        "count": len(data),
        "data": [format_environment_snapshot(d) for d in data]
    }


@router.get("/environment/latest")
def get_environment_latest(db: Session = Depends(get_db)):
    data = db.query(EnvironmentSnapshot).order_by(EnvironmentSnapshot.id.desc()).first()
    if data is None:
        return {}
    return format_environment_snapshot(data)


@router.get("/environment/history")
def get_environment_history(hours: int = 24, db: Session = Depends(get_db)):
    since = get_current_time() - timedelta(hours=hours)
    data = db.query(EnvironmentSnapshot).filter(EnvironmentSnapshot.created_at >= since).order_by(EnvironmentSnapshot.id.desc()).all()
    return {
        "count": len(data),
        "data": [format_environment_snapshot(d) for d in data]
    }


@router.get("/operation")
@router.get("/telemetry/operation")
def get_operation_data(limit: int = 100, db: Session = Depends(get_db)):
    data = db.query(OperationSnapshot).order_by(
        OperationSnapshot.id.desc()
    ).limit(limit).all()
    return {
        "count": len(data),
        "data": [
            {
                "id": d.id,
                "rack_id": d.rack_id,
                "movement_speed": d.movement_speed,
                "displacement": d.displacement,
                "is_hard_locked": d.is_hard_locked,
                "is_endpoint": d.is_endpoint,
                "state": d.state,
                "created_at": format_datetime(d.created_at) if d.created_at else None
            }
            for d in data
        ]
    }


@router.get("/breakdown")
@router.get("/telemetry/breakdown")
def get_breakdown_data(limit: int = 100, db: Session = Depends(get_db)):
    data = db.query(BreakdownSnapshot).order_by(
        BreakdownSnapshot.id.desc()
    ).limit(limit).all()
    return {
        "count": len(data),
        "data": [
            {
                "id": d.id,
                "rack_id": d.rack_id,
                "is_obstructed": d.is_obstructed,
                "is_skewed": d.is_skewed,
                "is_overload_motor": d.is_overload_motor,
                "created_at": format_datetime(d.created_at) if d.created_at else None
            }
            for d in data
        ]
    }


def format_breakdown_snapshot(d: BreakdownSnapshot):
    active = bool(d.is_obstructed or d.is_skewed or d.is_overload_motor)
    return {
        "id": d.id,
        "rack_id": d.rack_id,
        "is_obstructed": d.is_obstructed,
        "is_skewed": d.is_skewed,
        "is_overload_motor": d.is_overload_motor,
        "active": active,
        "created_at": format_datetime(d.created_at) if d.created_at else None
    }


@router.get("/breakdown/{rack_id}/latest")
@router.get("/telemetry/breakdown/{rack_id}/latest")
def get_breakdown_status(rack_id: int, db: Session = Depends(get_db)):
    data = db.query(BreakdownSnapshot).filter(BreakdownSnapshot.rack_id == rack_id).order_by(
        BreakdownSnapshot.id.desc()
    ).first()
    if data is None:
        return {
            "rack_id": rack_id,
            "is_obstructed": 0,
            "is_skewed": 0,
            "is_overload_motor": 0,
            "active": False,
            "created_at": None
        }
    return format_breakdown_snapshot(data)
