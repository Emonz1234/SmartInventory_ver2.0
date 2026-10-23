from typing import List, Optional

from sqlalchemy import func
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ipc_core.app.database.models.inventory import Bin
from ipc_core.app.database.models.inventory import Cabinet
from ipc_core.app.database.models.inventory import Rack
from ipc_core.app.database.models.inventory import Shelf
from ipc_core.app.database.models.inventory import InventoryTransaction
from ipc_core.app.database.models.inventory import Item
from ipc_core.app.database.models.inventory import ItemLocation
from ipc_core.app.utils.timezone import get_current_time


class ItemRepository:

    def create_item(self, db: Session, item_data: dict) -> Item:
        item = Item(
            item_code=item_data["item_code"],
            item_name=item_data["item_name"],
            unit=item_data["unit"],
            min_qty=item_data.get("min_qty", 0),
            max_qty=item_data.get("max_qty", 0)
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    def update_item(self, db: Session, item: Item, update_data: dict) -> Item:
        for field, value in update_data.items():
            if value is not None and hasattr(item, field):
                setattr(item, field, value)
        db.commit()
        db.refresh(item)
        return item

    def delete_item(self, db: Session, item: Item) -> None:
        db.delete(item)
        db.commit()

    def get_item(self, db: Session, item_id: int) -> Optional[Item]:
        return db.query(Item).filter(Item.id == item_id).first()

    def get_item_by_code(self, db: Session, item_code: str) -> Optional[Item]:
        return db.query(Item).filter(Item.item_code == item_code).first()

    def search_item(self, db: Session, query: str) -> List[Item]:
        search_term = f"%{query}%"
        return db.query(Item).filter(
            or_(
                Item.item_code.ilike(search_term),
                Item.item_name.ilike(search_term)
            )
        ).order_by(Item.id).all()

    def list_items(self, db: Session) -> List[Item]:
        return db.query(Item).order_by(Item.id).all()


class LocationRepository:

    def get_bin(self, db: Session, bin_id: int) -> Optional[Bin]:
        return db.query(Bin).filter(Bin.id == bin_id).first()

    def get_bin_by_code(self, db: Session, bin_code: str) -> Optional[Bin]:
        return db.query(Bin).filter(Bin.bin_code == bin_code).first()

    def list_bins(self, db: Session) -> List[Bin]:
        return db.query(Bin).order_by(Bin.id).all()

    def get_shelf(self, db: Session, shelf_id: int) -> Optional[Shelf]:
        return db.query(Shelf).filter(Shelf.id == shelf_id).first()

    def get_shelf_by_code(self, db: Session, shelf_code: str) -> Optional[Shelf]:
        return db.query(Shelf).filter(Shelf.shelf_code == shelf_code).first()

    def get_location_details(self, db: Session, item_location: ItemLocation) -> dict:
        bin_obj = self.get_bin(db, item_location.bin_id)
        shelf = self.get_shelf(db, bin_obj.shelf_id) if bin_obj else None
        rack = self.get_rack(db, shelf.rack_id) if shelf else None
        cabinet = self.get_cabinet(db, rack.cabinet_id) if rack else None
        location_path = None
        if cabinet or rack or shelf or bin_obj:
            parts = []
            if cabinet and cabinet.cabinet_code:
                parts.append(cabinet.cabinet_code)
            if rack and rack.rack_code:
                parts.append(f"Rack {rack.rack_index:02d}" if rack.rack_index else rack.rack_name or rack.rack_code)
            if shelf and shelf.shelf_code:
                parts.append(shelf.shelf_code)
            if bin_obj and bin_obj.bin_code:
                parts.append(bin_obj.bin_code)
            location_path = '/'.join(parts) if parts else None
        return {
            "id": item_location.id,
            "item_id": item_location.item_id,
            "bin_id": item_location.bin_id,
            "quantity": item_location.quantity,
            "updated_at": item_location.updated_at,
            "bin_code": bin_obj.bin_code if bin_obj else None,
            "bin_name": bin_obj.bin_name if bin_obj else None,
            "shelf_id": shelf.id if shelf else None,
            "shelf_code": shelf.shelf_code if shelf else None,
            "shelf_name": shelf.shelf_name if shelf else None,
            "rack_id": rack.id if rack else None,
            "rack_code": (rack.rack_identity_code or rack.rack_code) if rack else None,
            "serial_address": int(rack.rack_code) if rack and rack.rack_code.isdigit() else None,
            "rack_name": rack.rack_name if rack else None,
            "cabinet_id": cabinet.id if cabinet else None,
            "cabinet_code": cabinet.cabinet_code if cabinet else None,
            "cabinet_name": cabinet.cabinet_name if cabinet else None,
            "device_code": cabinet.device_code if cabinet else None,
            "device_type": cabinet.device_type if cabinet else None,
            "cabinet_index": cabinet.cabinet_index if cabinet else None,
            "rack_index": rack.rack_index if rack else None,
            "rack_identity_code": rack.rack_identity_code if rack else None,
            "location_path": location_path
        }

    def get_rack(self, db: Session, rack_id: int) -> Optional[Rack]:
        return db.query(Rack).filter(Rack.id == rack_id).first()

    def get_cabinet(self, db: Session, cabinet_id: int) -> Optional[Cabinet]:
        return db.query(Cabinet).filter(Cabinet.id == cabinet_id).first()

    def get_default_shelf(self, db: Session) -> Shelf:
        shelf = db.query(Shelf).first()
        if shelf:
            return shelf

        rack = db.query(Rack).first()
        if not rack:
            cabinet = db.query(Cabinet).first()
            if not cabinet:
                cabinet = Cabinet(cabinet_code="DEFAULT", cabinet_name="Default Cabinet")
                db.add(cabinet)
                db.commit()
                db.refresh(cabinet)
            rack = Rack(cabinet_id=cabinet.id, rack_code="R01", rack_name="Default Rack")
            db.add(rack)
            db.commit()
            db.refresh(rack)

        shelf = Shelf(rack_id=rack.id, shelf_code="S01", shelf_name="Default Shelf", level_no=1)
        db.add(shelf)
        db.commit()
        db.refresh(shelf)
        return shelf

    def _parse_shelf_code(self, bin_code: str) -> Optional[str]:
        parts = bin_code.split("-")
        if len(parts) >= 3:
            return parts[2]
        return None

    def create_bin(self, db: Session, bin_data: dict) -> Bin:
        shelf_id = bin_data.get("shelf_id")
        if shelf_id is None:
            shelf_code = None
            if bin_data.get("bin_code"):
                shelf_code = self._parse_shelf_code(bin_data["bin_code"])
            if shelf_code:
                shelf = self.get_shelf_by_code(db, shelf_code)
                if shelf:
                    shelf_id = shelf.id
            if shelf_id is None:
                shelf_id = self.get_default_shelf(db).id

        bin_obj = Bin(
            shelf_id=shelf_id,
            bin_code=bin_data["bin_code"],
            bin_name=bin_data.get("bin_name"),
            capacity=bin_data.get("capacity", 0)
        )
        db.add(bin_obj)
        db.commit()
        db.refresh(bin_obj)
        return bin_obj

    def update_bin(self, db: Session, bin: Bin, update_data: dict) -> Bin:
        for field, value in update_data.items():
            if value is not None and hasattr(bin, field):
                setattr(bin, field, value)
        db.commit()
        db.refresh(bin)
        return bin

    def delete_bin(self, db: Session, bin: Bin) -> None:
        db.delete(bin)
        db.commit()

    def get_item_location(self, db: Session, item_id: int, bin_id: int) -> Optional[ItemLocation]:
        return db.query(ItemLocation).filter(
            ItemLocation.item_id == item_id,
            ItemLocation.bin_id == bin_id
        ).first()

    def get_locations_by_item(self, db: Session, item_id: int) -> List[ItemLocation]:
        return db.query(ItemLocation).filter(ItemLocation.item_id == item_id).all()

    def get_locations_by_bin(self, db: Session, bin_id: int) -> List[ItemLocation]:
        return db.query(ItemLocation).filter(ItemLocation.bin_id == bin_id).all()

    def update_location_qty(self, db: Session, item_id: int, bin_id: int, quantity: int) -> ItemLocation:
        location = self.get_item_location(db, item_id, bin_id)
        if location is None:
            location = ItemLocation(
                item_id=item_id,
                bin_id=bin_id,
                quantity=quantity,
                updated_at=get_current_time()
            )
            db.add(location)
        else:
            location.quantity = quantity
            location.updated_at = get_current_time()
        db.commit()
        db.refresh(location)
        return location


class InventoryRepository:

    def add_transaction(
        self,
        db: Session,
        item_id: int,
        transaction_type: str,
        quantity: int,
        reference_no: Optional[str] = None,
        user_id: Optional[int] = None
    ) -> InventoryTransaction:
        transaction = InventoryTransaction(
            item_id=item_id,
            transaction_type=transaction_type,
            quantity=quantity,
            reference_no=reference_no,
            user_id=user_id,
            created_at=get_current_time()
        )
        db.add(transaction)
        db.commit()
        db.refresh(transaction)
        return transaction

    def get_stock(self, db: Session, item_id: int) -> int:
        result = db.query(func.coalesce(func.sum(ItemLocation.quantity), 0)).filter(
            ItemLocation.item_id == item_id
        ).scalar()
        return int(result or 0)

    def get_transactions(self, db: Session, item_id: Optional[int] = None) -> List[dict]:
        query = db.query(InventoryTransaction)
        if item_id is not None:
            query = query.filter(InventoryTransaction.item_id == item_id)

        transactions = query.order_by(InventoryTransaction.created_at.desc()).all()
        result = []
        for tx in transactions:
            item = db.query(Item).filter(Item.id == tx.item_id).first()
            result.append({
                "id": tx.id,
                "item_id": tx.item_id,
                "item_code": item.item_code if item else None,
                "item_name": item.item_name if item else None,
                "transaction_type": tx.transaction_type,
                "quantity": tx.quantity,
                "reference_no": tx.reference_no,
                "user_id": tx.user_id,
                "created_at": tx.created_at
            })
        return result
