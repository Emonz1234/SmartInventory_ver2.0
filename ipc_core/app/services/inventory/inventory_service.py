from typing import List
from sqlalchemy.orm import Session

from ipc_core.app.repositories.inventory_repository import InventoryRepository
from ipc_core.app.repositories.inventory_repository import ItemRepository
from ipc_core.app.repositories.inventory_repository import LocationRepository


class InventoryService:

    def __init__(self):
        self.item_repository = ItemRepository()
        self.location_repository = LocationRepository()
        self.inventory_repository = InventoryRepository()

    def list_bins(self, db: Session) -> List[dict]:
        bins = self.location_repository.list_bins(db)
        return [
            {
                "id": bin_obj.id,
                "shelf_id": bin_obj.shelf_id,
                "bin_code": bin_obj.bin_code,
                "bin_name": bin_obj.bin_name,
                "capacity": bin_obj.capacity
            }
            for bin_obj in bins
        ]

    def get_bin(self, db: Session, bin_id: int) -> dict:
        bin_obj = self.location_repository.get_bin(db, bin_id)
        if bin_obj is None:
            raise ValueError("Bin not found")
        return {
            "id": bin_obj.id,
            "shelf_id": bin_obj.shelf_id,
            "bin_code": bin_obj.bin_code,
            "bin_name": bin_obj.bin_name,
            "capacity": bin_obj.capacity
        }
        bin_obj = self.location_repository.get_bin(db, bin_id)
        if bin_obj is None:
            raise ValueError("Bin not found")
        return {
            "id": bin_obj.id,
            "bin_code": bin_obj.bin_code,
            "bin_name": bin_obj.bin_name,
            "capacity": bin_obj.capacity
        }

    def create_bin(self, db: Session, bin_data: dict) -> dict:
        existing = self.location_repository.get_bin_by_code(db, bin_data["bin_code"])
        if existing:
            raise ValueError("Bin code already exists")
        bin_obj = self.location_repository.create_bin(db, bin_data)
        return {
            "id": bin_obj.id,
            "bin_code": bin_obj.bin_code,
            "bin_name": bin_obj.bin_name,
            "capacity": bin_obj.capacity
        }

    def update_bin(self, db: Session, bin_id: int, update_data: dict) -> dict:
        bin_obj = self.location_repository.get_bin(db, bin_id)
        if bin_obj is None:
            raise ValueError("Bin not found")
        if update_data.get("bin_code") and update_data["bin_code"] != bin_obj.bin_code:
            if self.location_repository.get_bin_by_code(db, update_data["bin_code"]):
                raise ValueError("Bin code already exists")
        bin_obj = self.location_repository.update_bin(db, bin_obj, update_data)
        return {
            "id": bin_obj.id,
            "bin_code": bin_obj.bin_code,
            "bin_name": bin_obj.bin_name,
            "capacity": bin_obj.capacity
        }

    def delete_bin(self, db: Session, bin_id: int) -> None:
        bin_obj = self.location_repository.get_bin(db, bin_id)
        if bin_obj is None:
            raise ValueError("Bin not found")
        if self.location_repository.get_locations_by_bin(db, bin_id):
            raise ValueError("Cannot delete bin with inventory locations")
        self.location_repository.delete_bin(db, bin_obj)

    def get_inventory(self, db: Session) -> List[dict]:
        items = self.item_repository.list_items(db)
        result = []
        for item in items:
            locations = self.location_repository.get_locations_by_item(db, item.id)
            result.append({
                "item_id": item.id,
                "item_code": item.item_code,
                "item_name": item.item_name,
                "unit": item.unit,
                "total_quantity": self.inventory_repository.get_stock(db, item.id),
                "locations": [
                    self.location_repository.get_location_details(db, loc)
                    for loc in locations
                ]
            })
        return result

    def get_item_stock(self, db: Session, item_id: int) -> dict:
        item = self.item_repository.get_item(db, item_id)
        if item is None:
            raise ValueError("Item not found")
        locations = self.location_repository.get_locations_by_item(db, item_id)
        return {
            "item_id": item.id,
            "item_code": item.item_code,
            "item_name": item.item_name,
            "unit": item.unit,
            "total_quantity": self.inventory_repository.get_stock(db, item_id),
            "locations": [
                self.location_repository.get_location_details(db, loc)
                for loc in locations
            ]
        }

    def get_location_stock(self, db: Session, bin_id: int) -> dict:
        bin_data = self.location_repository.get_bin(db, bin_id)
        if bin_data is None:
            raise ValueError("Bin not found")
        locations = self.location_repository.get_locations_by_bin(db, bin_id)
        items = []
        for loc in locations:
            item = self.item_repository.get_item(db, loc.item_id)
            items.append({
                "item_id": loc.item_id,
                "item_code": item.item_code if item else None,
                "item_name": item.item_name if item else None,
                "quantity": loc.quantity
            })
        return {
            "bin_id": bin_data.id,
            "bin_code": bin_data.bin_code,
            "bin_name": bin_data.bin_name,
            "items": items
        }
