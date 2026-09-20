import sqlite3
import pytest
from sqlalchemy import create_engine
from ipc_core.app.database.database import Base
from ipc_core.app.database.models import inventory, runtime, environment, auth, system
from ipc_core.projection import project
from ipc_core.store import Store
from ipc_core.protocol import envelope, checksum


def test_projection_rolls_back_invalid_foreign_keys_and_preserves_history(tmp_path):
    path = tmp_path / "projection.db"
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    engine.dispose()
    store = Store(path, "edge", "IPC")
    records = [{"key":"cabinet:1","kind":"cabinet","domain":"IPC","data":{"id":1,"cabinet_code":"C"}},
               {"key":"rack:2","kind":"rack","domain":"IPC","data":{"id":2,"cabinet_id":1,"rack_code":"7"}}]
    def full(rev, rows):
        return envelope("edge","IPC","sync.full",dict(records=rows,index=0,count=1,digest=checksum(rows)),dataset_id="edge",revision=rev,sync_id=str(rev))
    store.apply(full(1,records), project)
    with store.transaction() as db:
        db.execute("INSERT INTO operation_snapshots(rack_id) VALUES(2)")
    with pytest.raises(sqlite3.IntegrityError):
        store.apply(full(2,records[1:]), project)
    assert store.revision() == 1
    store.apply(full(2,[]), project)
    with store.transaction() as db:
        assert db.execute("SELECT count(*) FROM racks").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM operation_snapshots").fetchone()[0] == 1
