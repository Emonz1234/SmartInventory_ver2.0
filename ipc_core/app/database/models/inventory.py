from sqlalchemy import Column
from sqlalchemy import DateTime
from sqlalchemy import Float
from sqlalchemy import ForeignKey
from sqlalchemy import Integer
from sqlalchemy import String
from sqlalchemy import UniqueConstraint
from sqlalchemy import Boolean

from ipc_core.app.database.database import Base
from ipc_core.app.utils.timezone import get_current_time


class Cabinet(Base):
    __tablename__ = "cabinets"

    id = Column(Integer, primary_key=True)
    cabinet_code = Column(String, unique=True, nullable=False)
    cabinet_name = Column(String, nullable=True)
    status = Column(String, default="ACTIVE")
    description = Column(String, default='')


class Rack(Base):
    __tablename__ = "racks"

    id = Column(Integer, primary_key=True)
    cabinet_id = Column(Integer, ForeignKey("cabinets.id"), nullable=False)
    rack_code = Column(String, nullable=False)
    rack_name = Column(String, nullable=True)


class Shelf(Base):
    __tablename__ = "shelves"

    id = Column(Integer, primary_key=True)
    rack_id = Column(Integer, ForeignKey("racks.id"), nullable=False)
    shelf_code = Column(String, nullable=False)
    shelf_name = Column(String, nullable=True)
    level_no = Column(Integer, nullable=True)


class Bin(Base):
    __tablename__ = "bins"

    id = Column(Integer, primary_key=True)
    shelf_id = Column(Integer, ForeignKey("shelves.id"), nullable=False)
    bin_code = Column(String, nullable=False)
    bin_name = Column(String, nullable=True)
    capacity = Column(Integer, nullable=False, default=0)


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True)
    item_code = Column(String, unique=True, nullable=False)
    item_name = Column(String, nullable=False)
    unit = Column(String, nullable=False)
    min_qty = Column(Integer, nullable=False, default=0)
    max_qty = Column(Integer, nullable=False, default=0)
    category = Column(String, default='')
    description = Column(String, default='')
    is_active = Column(Boolean, default=True)
    is_demo = Column(Boolean, default=False)


class ItemLocation(Base):
    __tablename__ = "item_locations"
    __table_args__ = (
        UniqueConstraint("item_id", "bin_id", name="uix_item_bin"),
    )

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    bin_id = Column(Integer, ForeignKey("bins.id"), nullable=False)
    quantity = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=get_current_time, onupdate=get_current_time)


class InventoryTransaction(Base):
    __tablename__ = "inventory_transactions"

    id = Column(Integer, primary_key=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False)
    transaction_type = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    reference_no = Column(String, nullable=True)
    user_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=get_current_time)
