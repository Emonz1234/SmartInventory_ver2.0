from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import Float
from sqlalchemy import DateTime

from ipc_core.app.database.database import Base
from ipc_core.app.utils.timezone import get_current_time


class EnvironmentSnapshot(Base):
    __tablename__ = "environment_snapshots"

    id = Column(Integer, primary_key=True)

    rack_id = Column(Integer)

    temperature = Column(Float)

    humidity = Column(Float)

    weight = Column(Float)
    gas = Column(Float)

    smoke_detected = Column(Integer)

    created_at = Column(DateTime, default=get_current_time)
