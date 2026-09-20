from sqlalchemy.orm import Session

from ipc_core.app.repositories.inventory_repository import InventoryRepository
from ipc_core.app.repositories.inventory_repository import ItemRepository
from ipc_core.app.repositories.inventory_repository import LocationRepository
from ipc_core.app.services.communication.command_service import CommandService
from ipc_core.app.database.models.runtime import OperationSnapshot


class TransactionService:

    def __init__(self):
        self.item_repository = ItemRepository()
        self.location_repository = LocationRepository()
        self.inventory_repository = InventoryRepository()
        self.command_service = CommandService()

    def _resolve_bin_id(self, db: Session, payload: dict, transaction_type: str) -> int:
        if payload.get("bin_id") is not None:
            return payload["bin_id"]
        if payload.get("bin_code"):
            bin_data = self.location_repository.get_bin_by_code(db, payload["bin_code"])
            if bin_data is None:
                raise ValueError("Bin not found")
            return bin_data.id

        if transaction_type == "PICK":
            locations = self.location_repository.get_locations_by_item(db, payload["item_id"])
            if not locations:
                raise ValueError("No inventory locations available to pick")
            best_location = max(locations, key=lambda loc: loc.quantity)
            return best_location.bin_id

        if transaction_type == "PUT":
            bins = self.location_repository.list_bins(db)
            if not bins:
                raise ValueError("No bins available for put transactions")
            return bins[0].id

        if transaction_type == "ADJUST":
            locations = self.location_repository.get_locations_by_item(db, payload["item_id"])
            if not locations:
                raise ValueError("No inventory locations available to adjust")
            return locations[0].bin_id

        raise ValueError("Either bin_id or bin_code is required")

    def _open_rack_for_bin(self, db: Session, bin_id: int):
        bin_data = self.location_repository.get_bin(db, bin_id)
        if bin_data is None:
            raise ValueError("Bin not found")
        shelf = self.location_repository.get_shelf(db, bin_data.shelf_id)
        if shelf is None:
            raise ValueError("Shelf not found")
        rack = self.location_repository.get_rack(db, shelf.rack_id)
        if rack is None:
            raise ValueError("Rack not found")

        latest_operation = db.query(OperationSnapshot).filter(
            OperationSnapshot.rack_id == rack.id
        ).order_by(OperationSnapshot.created_at.desc()).first()
        if latest_operation and latest_operation.is_endpoint == 1 and (latest_operation.displacement or 0) > 0:
            return

        self.command_service.send_open_rack(rack.id)

    def create_put_transaction(self, db: Session, payload: dict):
        item = self.item_repository.get_item(db, payload["item_id"])
        if item is None:
            raise ValueError("Item not found")
        bin_id = self._resolve_bin_id(db, payload, "PUT")
        bin_data = self.location_repository.get_bin(db, bin_id)
        if bin_data is None:
            raise ValueError("Bin not found")
        self._open_rack_for_bin(db, bin_id)
        quantity = payload["quantity"]
        if quantity <= 0:
            raise ValueError("Quantity must be greater than zero for put transactions")
        current = self.location_repository.get_item_location(db, payload["item_id"], bin_id)
        new_quantity = (current.quantity if current else 0) + quantity
        self.location_repository.update_location_qty(db, payload["item_id"], bin_id, new_quantity)
        return self.inventory_repository.add_transaction(
            db,
            item_id=payload["item_id"],
            transaction_type="PUT",
            quantity=quantity,
            reference_no=payload.get("reference_no"),
            user_id=payload.get("user_id")
        )

    def create_pick_transaction(self, db: Session, payload: dict):
        item = self.item_repository.get_item(db, payload["item_id"])
        if item is None:
            raise ValueError("Item not found")
        bin_id = self._resolve_bin_id(db, payload, "PICK")
        bin_data = self.location_repository.get_bin(db, bin_id)
        if bin_data is None:
            raise ValueError("Bin not found")
        self._open_rack_for_bin(db, bin_id)
        quantity = payload["quantity"]
        if quantity <= 0:
            raise ValueError("Quantity must be greater than zero for pick transactions")
        location = self.location_repository.get_item_location(db, payload["item_id"], bin_id)
        if location is None or location.quantity < quantity:
            raise ValueError("Not enough quantity available to pick")
        new_quantity = location.quantity - quantity
        self.location_repository.update_location_qty(db, payload["item_id"], bin_id, new_quantity)
        return self.inventory_repository.add_transaction(
            db,
            item_id=payload["item_id"],
            transaction_type="PICK",
            quantity=quantity,
            reference_no=payload.get("reference_no"),
            user_id=payload.get("user_id")
        )

    def create_adjust_transaction(self, db: Session, payload: dict):
        item = self.item_repository.get_item(db, payload["item_id"])
        if item is None:
            raise ValueError("Item not found")
        bin_id = self._resolve_bin_id(db, payload, "ADJUST")
        bin_data = self.location_repository.get_bin(db, bin_id)
        if bin_data is None:
            raise ValueError("Bin not found")
        quantity = payload["quantity"]
        if quantity < 0:
            raise ValueError("Quantity must be non-negative")
        self.location_repository.update_location_qty(db, payload["item_id"], bin_id, quantity)
        return self.inventory_repository.add_transaction(
            db,
            item_id=payload["item_id"],
            transaction_type="ADJUST",
            quantity=quantity,
            reference_no=payload.get("reference_no"),
            user_id=payload.get("user_id")
        )
