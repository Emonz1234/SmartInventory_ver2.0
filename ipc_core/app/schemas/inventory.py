from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel
from pydantic import conint
from pydantic import constr
from pydantic import root_validator
from pydantic import field_validator

from ipc_core.app.utils.timezone import format_datetime


class ItemBase(BaseModel):
    item_code: constr(strip_whitespace=True, min_length=1)
    item_name: str
    unit: str
    min_qty: conint(ge=0) = 0
    max_qty: conint(ge=0) = 0


class ItemCreate(ItemBase):
    pass


class ItemUpdate(BaseModel):
    item_code: Optional[constr(strip_whitespace=True, min_length=1)] = None
    item_name: Optional[str] = None
    unit: Optional[str] = None
    min_qty: Optional[conint(ge=0)] = None
    max_qty: Optional[conint(ge=0)] = None


class ItemOut(ItemBase):
    id: int

    class Config:
        orm_mode = True


class ItemLocationOut(BaseModel):
    id: int
    item_id: int
    bin_id: int
    quantity: int
    updated_at: Optional[str] = None
    bin_code: Optional[str] = None
    bin_name: Optional[str] = None
    shelf_id: Optional[int] = None
    shelf_code: Optional[str] = None
    shelf_name: Optional[str] = None
    rack_id: Optional[int] = None
    rack_code: Optional[str] = None
    rack_name: Optional[str] = None
    cabinet_id: Optional[int] = None
    cabinet_code: Optional[str] = None
    cabinet_name: Optional[str] = None
    device_code: Optional[str] = None
    device_type: Optional[str] = None
    cabinet_index: Optional[int] = None
    rack_index: Optional[int] = None
    rack_identity_code: Optional[str] = None
    serial_address: Optional[int] = None
    location_path: Optional[str] = None

    @field_validator('updated_at', mode='before')
    @classmethod
    def format_updated_at(cls, v):
        if v is None:
            return None
        if isinstance(v, datetime):
            return format_datetime(v)
        return v

    class Config:
        orm_mode = True


class InventoryItemOut(BaseModel):
    item_id: int
    item_code: str
    item_name: str
    total_quantity: int
    locations: List[ItemLocationOut] = []


class BinStockItemOut(BaseModel):
    item_id: int
    item_code: str
    item_name: str
    quantity: int


class LocationStockOut(BaseModel):
    bin_id: int
    bin_code: Optional[str] = None
    bin_name: Optional[str] = None
    items: List[BinStockItemOut] = []


class BinBase(BaseModel):
    shelf_id: Optional[int] = None
    bin_code: constr(strip_whitespace=True, min_length=1)
    bin_name: Optional[str] = None
    capacity: Optional[int] = 0


class BinCreate(BinBase):
    pass


class BinUpdate(BaseModel):
    shelf_id: Optional[int] = None
    bin_code: Optional[constr(strip_whitespace=True, min_length=1)] = None
    bin_name: Optional[str] = None
    capacity: Optional[int] = None


class BinOut(BinBase):
    id: int

    class Config:
        orm_mode = True


class TransactionCreate(BaseModel):
    item_id: int
    bin_id: Optional[int] = None
    bin_code: Optional[str] = None
    quantity: conint(ge=0)
    reference_no: Optional[str] = None
    user_id: Optional[int] = None

    @root_validator(pre=True)
    def must_provide_bin(cls, values):
        if values.get("bin_id") is None and not values.get("bin_code"):
            return values
        return values


class TransactionOut(BaseModel):
    id: int
    item_id: int
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    transaction_type: str
    quantity: int
    reference_no: Optional[str] = None
    user_id: Optional[int] = None
    created_at: Optional[str] = None  # Will be formatted as string

    @field_validator('created_at', mode='before')
    @classmethod
    def format_created_at(cls, v):
        if v is None:
            return None
        if isinstance(v, datetime):
            return format_datetime(v)
        return v

    class Config:
        orm_mode = True
