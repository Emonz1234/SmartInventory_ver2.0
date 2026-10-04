from sqlalchemy.orm import Session
from ipc_core.app.database.database import SessionLocal
from ipc_core.app.database.models.environment import EnvironmentSnapshot
from ipc_core.app.serial.protocol.parser import normalize_smoke_value
from ipc_core.app.serial.location import describe_location
import traceback


class TelemetryHandler:

    async def handle(self, payload):

        print(f"TELEMETRY (DB): {describe_location(payload)}")

        db = SessionLocal()
        try:
            # Coerce/normalize incoming values to expected types
            rack_id_raw = payload.get("rack_id") if payload.get("rack_id") is not None else payload.get("rack")
            try:
                rack_id = int(rack_id_raw) if rack_id_raw is not None else None
            except Exception:
                rack_id = None

            def to_float(v):
                try:
                    return float(v) if v is not None and v != "" else None
                except Exception:
                    return None

            # pick first value that's not None (to allow 0 values)
            def pick(*keys):
                for k in keys:
                    v = payload.get(k)
                    if v is not None:
                        return v
                return None

            temperature = to_float(pick("temperature", "temp", "t"))
            humidity = to_float(pick("humidity", "hum", "h"))
            weight = to_float(pick("weight", "w"))
            smoke = normalize_smoke_value(pick("smoke", "smoke_detected", "s"))

            snapshot = EnvironmentSnapshot(
                rack_id=rack_id,
                temperature=temperature,
                humidity=humidity,
                weight=weight,
                gas=to_float(payload.get("gas")),
                smoke_detected=smoke
            )
            db.add(snapshot)
            db.commit()
            print(f"[DB] Saved environment snapshot: id={snapshot.id} {describe_location(payload)}")
        except Exception as e:
            print(f"[ERROR] Failed to save telemetry: {e}")
            traceback.print_exc()
            db.rollback()
        finally:
            db.close()
