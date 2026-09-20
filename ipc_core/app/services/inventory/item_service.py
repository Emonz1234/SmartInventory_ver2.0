from sqlalchemy.orm import Session

from ipc_core.app.repositories.inventory_repository import InventoryRepository
from ipc_core.app.repositories.inventory_repository import ItemRepository


class ItemService:

    def __init__(self):
        self.item_repository = ItemRepository()
        self.inventory_repository = InventoryRepository()

    def create_item(self, db: Session, item_data: dict):
        existing = self.item_repository.get_item_by_code(db, item_data["item_code"])
        if existing:
            raise ValueError("Item code already exists")
        return self.item_repository.create_item(db, item_data)

    def update_item(self, db: Session, item_id: int, update_data: dict):
        item = self.item_repository.get_item(db, item_id)
        if item is None:
            raise ValueError("Item not found")
        if update_data.get("item_code") and update_data["item_code"] != item.item_code:
            if self.item_repository.get_item_by_code(db, update_data["item_code"]):
                raise ValueError("Item code already exists")
        return self.item_repository.update_item(db, item, update_data)

    def delete_item(self, db: Session, item_id: int):
        item = self.item_repository.get_item(db, item_id)
        if item is None:
            raise ValueError("Item not found")
        stock = self.inventory_repository.get_stock(db, item_id)
        if stock > 0:
            raise ValueError("Cannot delete item with existing stock")
        self.item_repository.delete_item(db, item)

    def get_item(self, db: Session, item_id: int):
        return self.item_repository.get_item(db, item_id)

    def list_items(self, db: Session):
        return self.item_repository.list_items(db)

    def search_item(self, db: Session, query: str):
        return self.item_repository.search_item(db, query)
