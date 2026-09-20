from pydantic import BaseModel
from typing import Optional

class CabinetCreate(BaseModel):
    cabinet_code: str
    cabinet_name: Optional[str]

class CabinetUpdate(BaseModel):
    cabinet_code: Optional[str]
    cabinet_name: Optional[str]

class RackCreate(BaseModel):
    rack_code: str
    rack_name: Optional[str]

class RackUpdate(BaseModel):
    rack_code: Optional[str]
    rack_name: Optional[str]
