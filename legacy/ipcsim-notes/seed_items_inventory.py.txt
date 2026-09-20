"""Seed script for item catalog, bins, and initial inventory stock."""

from app.database.database import ensure_schema, SessionLocal
from app.database.models.inventory import Bin, Item, Shelf
from app.repositories.inventory_repository import LocationRepository


def seed():
    ensure_schema()
    db = SessionLocal()
    try:
        sample_items = [
            {"item_code": "A1001", "item_name": "Motor Bearing", "unit": "pcs", "min_qty": 10, "max_qty": 200},
            {"item_code": "B2002", "item_name": "Coupling Assembly", "unit": "pcs", "min_qty": 5, "max_qty": 100},
            {"item_code": "C3003", "item_name": "Hydraulic Seal", "unit": "pcs", "min_qty": 8, "max_qty": 150},
            {"item_code": "D4004", "item_name": "Sensor Cable", "unit": "m", "min_qty": 20, "max_qty": 500},
            {"item_code": "E5005", "item_name": "Control Board", "unit": "pcs", "min_qty": 2, "max_qty": 50}
        ]

        sample_bins = [
            {"bin_code": "A-R01-S01-B01", "bin_name": "Bin 1", "capacity": 100},
            {"bin_code": "A-R01-S01-B02", "bin_name": "Bin 2", "capacity": 100},
            {"bin_code": "A-R01-S01-B03", "bin_name": "Bin 3", "capacity": 100}
        ]

        created_items = 0
        for item_data in sample_items:
            if not db.query(Item).filter(Item.item_code == item_data["item_code"]).first():
                item = Item(**item_data)
                db.add(item)
                created_items += 1

        created_bins = 0
        location_repo = LocationRepository()
        for bin_data in sample_bins:
            if not db.query(Bin).filter(Bin.bin_code == bin_data["bin_code"]).first():
                location_repo.create_bin(db, bin_data)
                created_bins += 1

        db.commit()

        stock_updates = [
            {"item_code": "A1001", "bin_code": "A-R01-S01-B01", "quantity": 50},
            {"item_code": "B2002", "bin_code": "A-R01-S01-B01", "quantity": 20},
            {"item_code": "C3003", "bin_code": "A-R01-S01-B02", "quantity": 30},
            {"item_code": "D4004", "bin_code": "A-R01-S01-B02", "quantity": 120},
            {"item_code": "E5005", "bin_code": "A-R01-S01-B03", "quantity": 10}
        ]

        created_stock = 0
        for update in stock_updates:
            item = db.query(Item).filter(Item.item_code == update["item_code"]).first()
            bin_obj = db.query(Bin).filter(Bin.bin_code == update["bin_code"]).first()
            if item and bin_obj:
                location_repo.update_location_qty(db, item.id, bin_obj.id, update["quantity"])
                created_stock += 1

        print(f"Created items: {created_items}, created bins: {created_bins}, created stock entries: {created_stock}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
