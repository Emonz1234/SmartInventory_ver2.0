"""Seed script: create 21 cabinets (ids 1..21) each with 6 racks.

Mapping: rack_id = (cabinet_id - 1) * 6 + rack_index (1..6)

Run: python -m scripts.seed_cabinets (from IPCSIM package root)
"""

from app.database.database import ensure_schema, SessionLocal
from app.database.models.inventory import Cabinet, Rack


def seed():
    ensure_schema()
    db = SessionLocal()
    try:
        created = 0
        for cabinet_id in range(1, 22):
            cabinet = db.query(Cabinet).filter(Cabinet.id == cabinet_id).first()
            if not cabinet:
                cabinet = Cabinet(id=cabinet_id, cabinet_code=str(cabinet_id), cabinet_name=f"Cabinet {cabinet_id}")
                db.add(cabinet)
                db.commit()
                created += 1
            for i in range(1, 7):
                rack_id = (cabinet_id - 1) * 6 + i
                rack = db.query(Rack).filter(Rack.id == rack_id).first()
                if not rack:
                    rack = Rack(id=rack_id, cabinet_id=cabinet_id, rack_code=str(rack_id), rack_name=f"Rack {rack_id}")
                    db.add(rack)
                    db.commit()
        print("Seeding complete")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
