from typing import List, Optional

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from sqlalchemy.orm import Session

from ipc_core.app.database.database import get_db
from ipc_core.app.schemas.inventory import ItemCreate
from ipc_core.app.schemas.inventory import ItemOut
from ipc_core.app.schemas.inventory import ItemUpdate
from ipc_core.app.schemas.inventory import InventoryItemOut
from ipc_core.app.schemas.inventory import LocationStockOut
from ipc_core.app.schemas.inventory import TransactionCreate
from ipc_core.app.schemas.inventory import TransactionOut
from ipc_core.app.services.inventory.inventory_service import InventoryService
from ipc_core.app.services.inventory.item_service import ItemService
from ipc_core.app.services.inventory.transaction_service import TransactionService

router = APIRouter(prefix="/api", tags=["inventory"])

item_service = ItemService()
inventory_service = InventoryService()
transaction_service = TransactionService()


@router.get("/items", response_model=List[ItemOut])
def list_items(db: Session = Depends(get_db)):
    return item_service.list_items(db)


@router.get("/items/{item_id:int}", response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = item_service.get_item(db, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.post("/items", response_model=ItemOut)
def create_item(payload: ItemCreate, db: Session = Depends(get_db)):
    try:
        return item_service.create_item(db, payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/items/{item_id}", response_model=ItemOut)
def update_item(item_id: int, payload: ItemUpdate, db: Session = Depends(get_db)):
    try:
        return item_service.update_item(db, item_id, payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    try:
        item_service.delete_item(db, item_id)
        return {"status": "deleted"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/items/search", response_model=List[ItemOut])
def search_items(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    return item_service.search_item(db, q)


@router.get("/inventory", response_model=List[InventoryItemOut])
def list_inventory(db: Session = Depends(get_db)):
    return inventory_service.get_inventory(db)


@router.get("/inventory/{item_id}", response_model=InventoryItemOut)
def get_item_inventory(item_id: int, db: Session = Depends(get_db)):
    try:
        return inventory_service.get_item_stock(db, item_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/inventory/location/{bin_id}", response_model=LocationStockOut)
def get_location_inventory(bin_id: int, db: Session = Depends(get_db)):
    try:
        return inventory_service.get_location_stock(db, bin_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/transactions", response_model=List[TransactionOut])
def list_transactions(item_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    return transaction_service.inventory_repository.get_transactions(db, item_id)


@router.post("/transactions/pick", response_model=TransactionOut)
def pick_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    try:
        return transaction_service.create_pick_transaction(db, payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/transactions/put", response_model=TransactionOut)
def put_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    try:
        return transaction_service.create_put_transaction(db, payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/transactions/adjust", response_model=TransactionOut)
def adjust_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    try:
        return transaction_service.create_adjust_transaction(db, payload.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
