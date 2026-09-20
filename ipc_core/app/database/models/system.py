from sqlalchemy import Column
from sqlalchemy import Integer
from sqlalchemy import String

from ipc_core.app.database.database import Base


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True)

    device_code = Column(String, unique=True)

    device_name = Column(String)

    serial_port = Column(String)

    status = Column(String)