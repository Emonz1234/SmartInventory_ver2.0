from typing import List

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from sqlalchemy.orm import Session

from ipc_core.app.database.database import get_db
from ipc_core.app.schemas.inventory import BinCreate, BinOut, BinUpdate
from ipc_core.app.services.inventory.inventory_service import InventoryService

router = APIRouter(prefix="/api", tags=["bins"])

inventory_service = InventoryService()


@router.get("/bins", response_model=List[BinOut])
def list_bins(db: Session = Depends(get_db)):
    return inventory_service.list_bins(db)


@router.get("/bins/{bin_id}", response_model=BinOut)
def get_bin(bin_id: int, db: Session = Depends(get_db)):
    try:
        return inventory_service.get_bin(db, bin_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/bins", response_model=BinOut)
def create_bin(payload: BinCreate, db: Session = Depends(get_db)):
    try:
        return inventory_service.create_bin(db, payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/bins/{bin_id}", response_model=BinOut)
def update_bin(bin_id: int, payload: BinUpdate, db: Session = Depends(get_db)):
    try:
        return inventory_service.update_bin(db, bin_id, payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/bins/{bin_id}")
def delete_bin(bin_id: int, db: Session = Depends(get_db)):
    try:
        inventory_service.delete_bin(db, bin_id)
        return {"status": "deleted"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
