from datetime import timedelta
from typing import List

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ipc_core.app.database.database import get_db
from ipc_core.app.database.models.inventory import Cabinet
from ipc_core.app.database.models.inventory import Rack
from ipc_core.app.database.models.environment import EnvironmentSnapshot
from ipc_core.app.database.models.runtime import OperationSnapshot, BreakdownSnapshot
from ipc_core.app.services.communication.command_service import CommandService
from ipc_core.app.schemas.cabinet import CabinetCreate, CabinetUpdate, RackCreate, RackUpdate
from ipc_core.app.utils.timezone import format_datetime, get_current_time, to_vietnam_timezone

router = APIRouter(prefix="/api", tags=["cabinet"])

BREAKDOWN_ACTIVE_TIMEOUT = timedelta(seconds=30)
TELEMETRY_ACTIVE_TIMEOUT = timedelta(seconds=15)

service = CommandService()


@router.get("/cabinets")
def list_cabinets(db: Session = Depends(get_db)):
    cabinets = db.query(Cabinet).all()
    active_since = get_current_time() - TELEMETRY_ACTIVE_TIMEOUT
    result = []
    for cabinet in cabinets:
        rack_count = db.query(func.count(Rack.id)).filter(Rack.cabinet_id == cabinet.id).scalar() or 0
        latest_telemetry = db.query(func.max(EnvironmentSnapshot.created_at)).join(
            Rack, Rack.id == EnvironmentSnapshot.rack_id
        ).filter(Rack.cabinet_id == cabinet.id).scalar()
        if latest_telemetry is not None:
            latest_telemetry = to_vietnam_timezone(latest_telemetry)
        is_active = latest_telemetry is not None and latest_telemetry >= active_since
        result.append({
            "id": cabinet.id,
            "cabinet_code": cabinet.cabinet_code,
            "cabinet_name": cabinet.cabinet_name,
            "cabinet_index": cabinet.cabinet_index, "device_code": cabinet.device_code, "device_type": cabinet.device_type,
            "status": "ACTIVE" if is_active else "INACTIVE",
            "rack_count": rack_count
        })
    return result


@router.post("/cabinets")
def create_cabinet(payload: CabinetCreate, db: Session = Depends(get_db)):
    existing = db.query(Cabinet).filter(Cabinet.cabinet_code == payload.cabinet_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Cabinet code already exists")
    cabinet = Cabinet(cabinet_code=payload.cabinet_code, cabinet_name=payload.cabinet_name)
    db.add(cabinet)
    db.commit()
    db.refresh(cabinet)
    return {
        "id": cabinet.id,
        "cabinet_code": cabinet.cabinet_code,
        "cabinet_name": cabinet.cabinet_name,
        "status": cabinet.status
    }


@router.put("/cabinets/{cabinet_id}")
def update_cabinet(cabinet_id: int, payload: CabinetUpdate, db: Session = Depends(get_db)):
    cabinet = db.query(Cabinet).filter(Cabinet.id == cabinet_id).first()
    if cabinet is None:
        raise HTTPException(status_code=404, detail="Cabinet not found")
    if payload.cabinet_code and payload.cabinet_code != cabinet.cabinet_code:
        if db.query(Cabinet).filter(Cabinet.cabinet_code == payload.cabinet_code).first():
            raise HTTPException(status_code=400, detail="Cabinet code already exists")
        cabinet.cabinet_code = payload.cabinet_code
    if payload.cabinet_name is not None:
        cabinet.cabinet_name = payload.cabinet_name
    db.commit()
    db.refresh(cabinet)
    return {
        "id": cabinet.id,
        "cabinet_code": cabinet.cabinet_code,
        "cabinet_name": cabinet.cabinet_name,
        "status": cabinet.status
    }


@router.delete("/cabinets/{cabinet_id}")
def delete_cabinet(cabinet_id: int, db: Session = Depends(get_db)):
    cabinet = db.query(Cabinet).filter(Cabinet.id == cabinet_id).first()
    if cabinet is None:
        raise HTTPException(status_code=404, detail="Cabinet not found")
    rack_count = db.query(func.count(Rack.id)).filter(Rack.cabinet_id == cabinet.id).scalar() or 0
    if rack_count > 0:
        raise HTTPException(status_code=400, detail="Cannot delete cabinet with racks")
    db.delete(cabinet)
    db.commit()
    return {"status": "deleted", "cabinet_id": cabinet_id}


@router.get("/cabinets/{cabinet_id}/racks")
def get_cabinet_racks(cabinet_id: int, db: Session = Depends(get_db)):
    cabinet = db.query(Cabinet).filter(Cabinet.id == cabinet_id).first()
    if cabinet is None:
        raise HTTPException(status_code=404, detail="Cabinet not found")

    racks = db.query(Rack).filter(Rack.cabinet_id == cabinet_id).all()
    result = []
    for rack in racks:
        latest_op = db.query(OperationSnapshot).filter(OperationSnapshot.rack_id == rack.id).order_by(OperationSnapshot.created_at.desc()).first()
        status = "Unknown"
        position = None
        last_updated = None

        if latest_op:
            position = latest_op.displacement
            last_updated = format_datetime(latest_op.created_at) if latest_op.created_at else None
            if latest_op.is_endpoint == 1:
                status = "Opened" if latest_op.displacement and latest_op.displacement > 0 else "Closed"
            else:
                if latest_op.state == 1:
                    status = "Opening"
                elif latest_op.state == 2:
                    status = "Closing"
                elif latest_op.state == 3:
                    status = "Ventilating"
                else:
                    status = "Moving"

        result.append({
            "id": rack.id,
            "rack_code": rack.rack_code,
            "rack_name": rack.rack_name,
            "cabinet_id": cabinet.id, "cabinet_index": cabinet.cabinet_index,
            "cabinet_code": cabinet.cabinet_code, "device_code": cabinet.device_code, "device_type": cabinet.device_type,
            "rack_index": rack.rack_index, "rack_identity_code": rack.rack_identity_code,
            "serial_address": int(rack.rack_code) if rack.rack_code.isdigit() else None,
            "status": status,
            "position": position,
            "last_updated": last_updated
        })

    return result


@router.post("/cabinets/{cabinet_id}/racks")
def create_rack(cabinet_id: int, payload: RackCreate, db: Session = Depends(get_db)):
    cabinet = db.query(Cabinet).filter(Cabinet.id == cabinet_id).first()
    if cabinet is None:
        raise HTTPException(status_code=404, detail="Cabinet not found")
    existing = db.query(Rack).filter(Rack.cabinet_id == cabinet_id, Rack.rack_code == payload.rack_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="Rack code already exists in this cabinet")
    rack = Rack(cabinet_id=cabinet_id, rack_code=payload.rack_code, rack_name=payload.rack_name)
    db.add(rack)
    db.commit()
    db.refresh(rack)
    return {"id": rack.id, "cabinet_id": rack.cabinet_id, "rack_code": rack.rack_code, "rack_name": rack.rack_name}


@router.put("/racks/{rack_id}")
def update_rack(rack_id: int, payload: RackUpdate, db: Session = Depends(get_db)):
    rack = db.query(Rack).filter(Rack.id == rack_id).first()
    if rack is None:
        raise HTTPException(status_code=404, detail="Rack not found")
    if payload.rack_code and payload.rack_code != rack.rack_code:
        if db.query(Rack).filter(Rack.cabinet_id == rack.cabinet_id, Rack.rack_code == payload.rack_code).first():
            raise HTTPException(status_code=400, detail="Rack code already exists in this cabinet")
        rack.rack_code = payload.rack_code
    if payload.rack_name is not None:
        rack.rack_name = payload.rack_name
    db.commit()
    db.refresh(rack)
    return {"id": rack.id, "cabinet_id": rack.cabinet_id, "rack_code": rack.rack_code, "rack_name": rack.rack_name}


@router.delete("/racks/{rack_id}")
def delete_rack(rack_id: int, db: Session = Depends(get_db)):
    rack = db.query(Rack).filter(Rack.id == rack_id).first()
    if rack is None:
        raise HTTPException(status_code=404, detail="Rack not found")
    db.delete(rack)
    db.commit()
    return {"status": "deleted", "rack_id": rack_id}


@router.post("/cabinets/{cabinet_id}/ventilate")
def ventilate_cabinet(cabinet_id: int, db: Session = Depends(get_db)):
    cabinet = db.query(Cabinet).filter(Cabinet.id == cabinet_id).first()
    if cabinet is None:
        raise HTTPException(status_code=404, detail="Cabinet not found")

    racks = db.query(Rack).filter(Rack.cabinet_id == cabinet_id).all()
    if not racks:
        raise HTTPException(status_code=404, detail="No racks found for this cabinet")

    rack_codes = [rack.rack_code for rack in racks]
    for rack_code in rack_codes:
        service.send_ventilate_rack(rack_code)

    return {
        "status": "sent",
        "command": "VENTILATE_RACK",
        "cabinet_id": cabinet_id,
        "rack_codes": rack_codes
    }


def get_latest_breakdown(rack_id: int, db: Session) -> BreakdownSnapshot | None:
    return db.query(BreakdownSnapshot).filter(BreakdownSnapshot.rack_id == rack_id).order_by(BreakdownSnapshot.id.desc()).first()


def is_breakdown_active(rack_id: int, db: Session) -> bool:
    latest_breakdown = get_latest_breakdown(rack_id, db)
    if latest_breakdown is None:
        return False

    if not (latest_breakdown.is_obstructed or latest_breakdown.is_skewed or latest_breakdown.is_overload_motor):
        return False

    if latest_breakdown.created_at is None:
        return False

    created_at = to_vietnam_timezone(latest_breakdown.created_at)
    if created_at is None:
        return False

    if get_current_time() - created_at > BREAKDOWN_ACTIVE_TIMEOUT:
        return False

    return True


def breakdown_error_message(rack_id: int, db: Session) -> str:
    latest_breakdown = get_latest_breakdown(rack_id, db)
    if latest_breakdown is None:
        return ""

    if not is_breakdown_active(rack_id, db):
        return ""

    problems = []
    if latest_breakdown.is_obstructed:
        problems.append("Obstructed")
    if latest_breakdown.is_skewed:
        problems.append("Skewed")
    if latest_breakdown.is_overload_motor:
        problems.append("Overload")
    return ", ".join(problems) or "Unknown breakdown"


@router.api_route("/racks/{rack_id}/clear-breakdown", methods=["POST"])
def clear_rack_breakdown(rack_id: int, db: Session = Depends(get_db)):
    rack = db.query(Rack).filter(Rack.id == rack_id).first()
    if rack is None:
        raise HTTPException(status_code=404, detail="Rack not found")

    snapshot = BreakdownSnapshot(
        rack_id=rack_id,
        is_obstructed=0,
        is_skewed=0,
        is_overload_motor=0
    )
    db.add(snapshot)
    db.commit()
    return {
        "status": "cleared",
        "rack_id": rack_id,
        "rack_code": rack.rack_code
    }


@router.api_route("/racks/{rack_id}/open", methods=["GET", "POST"])
def open_rack_by_id(rack_id: int, db: Session = Depends(get_db)):
    rack = db.query(Rack).filter(Rack.id == rack_id).first()
    if rack is None:
        raise HTTPException(status_code=404, detail="Rack not found")

    if is_breakdown_active(rack_id, db):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot open rack {rack_id} because breakdown is active: {breakdown_error_message(rack_id, db)}"
        )

    service.send_open_rack(rack.id)
    return {
        "status": "sent",
        "command": "OPEN_RACK",
        "rack_id": rack_id,
        "rack_code": rack.rack_code
    }


@router.api_route("/racks/{rack_id}/close", methods=["GET", "POST"])
def close_rack_by_id(rack_id: int, db: Session = Depends(get_db)):
    rack = db.query(Rack).filter(Rack.id == rack_id).first()
    if rack is None:
        raise HTTPException(status_code=404, detail="Rack not found")

    if is_breakdown_active(rack_id, db):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot close rack {rack_id} because breakdown is active: {breakdown_error_message(rack_id, db)}"
        )

    service.send_close_rack(rack.id)
    return {
        "status": "sent",
        "command": "CLOSE_RACK",
        "rack_id": rack_id,
        "rack_code": rack.rack_code
    }


@router.api_route("/racks/{rack_id}/ventilate", methods=["GET", "POST"])
def ventilate_rack_by_id(rack_id: int, db: Session = Depends(get_db)):
    rack = db.query(Rack).filter(Rack.id == rack_id).first()
    if rack is None:
        raise HTTPException(status_code=404, detail="Rack not found")

    service.send_ventilate_rack(rack.rack_code)
    return {
        "status": "sent",
        "command": "VENTILATE_RACK",
        "rack_id": rack_id,
        "rack_code": rack.rack_code
    }
