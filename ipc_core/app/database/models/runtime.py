from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import Float
from sqlalchemy import Boolean
from sqlalchemy import DateTime

from ipc_core.app.database.database import Base
from ipc_core.app.utils.timezone import get_current_time


class OperationSnapshot(Base):
    __tablename__ = "operation_snapshots"

    id = Column(Integer, primary_key=True)
    
    rack_id = Column(Integer)
    movement_speed = Column(Float)
    displacement = Column(Float)
    is_hard_locked = Column(Integer)
    is_endpoint = Column(Integer)
    state = Column(Integer, nullable=True)
    
    created_at = Column(DateTime, default=get_current_time)


class BreakdownSnapshot(Base):
    __tablename__ = "breakdown_snapshots"

    id = Column(Integer, primary_key=True)
    
    rack_id = Column(Integer)
    is_obstructed = Column(Integer)
    is_skewed = Column(Integer)
    is_overload_motor = Column(Integer)
    
    created_at = Column(DateTime, default=get_current_time)
