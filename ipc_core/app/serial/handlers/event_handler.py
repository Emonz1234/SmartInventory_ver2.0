from ipc_core.app.database.database import SessionLocal
from ipc_core.app.database.models.runtime import OperationSnapshot, BreakdownSnapshot
from ipc_core.app.serial.location import describe_location


class EventHandler:

    async def handle(self, payload):

        print(f"EVENT (DB): {describe_location(payload)}")
        
        db = SessionLocal()
        try:
            if "movement_speed" in payload:
                snapshot = OperationSnapshot(
                    rack_id=payload.get("rack_id"),
                    movement_speed=payload.get("movement_speed"),
                    displacement=payload.get("displacement"),
                    is_hard_locked=payload.get("is_hard_locked"),
                    is_endpoint=payload.get("is_endpoint"),
                    state=payload.get("state")
                )
                db.add(snapshot)
                db.commit()
                print(f"[DB] Saved operation snapshot: {describe_location(payload)}")
            
            elif "is_obstructed" in payload:
                snapshot = BreakdownSnapshot(
                    rack_id=payload.get("rack_id"),
                    is_obstructed=payload.get("is_obstructed"),
                    is_skewed=payload.get("is_skewed"),
                    is_overload_motor=payload.get("is_overload_motor")
                )
                db.add(snapshot)
                db.commit()
                print(f"[DB] Saved breakdown snapshot: {describe_location(payload)}")
        except Exception as e:
            print(f"[ERROR] Failed to save event: {e}")
            db.rollback()
        finally:
            db.close()
