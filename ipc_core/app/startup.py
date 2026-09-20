from ipc_core.app.database.database import Base
from ipc_core.app.database.database import engine

# import models
from ipc_core.app.database.models.auth import User
from ipc_core.app.database.models.system import Device
from ipc_core.app.database.models.environment import EnvironmentSnapshot
from ipc_core.app.database.models.runtime import OperationSnapshot, BreakdownSnapshot

import asyncio

from ipc_core.app.serial import serial_manager
from ipc_core.app.serial.listener import SerialListener


def initialize_database():
    from ipc_core.app.database.database import ensure_schema

    ensure_schema()


listener = SerialListener()


async def start_serial():

    return asyncio.create_task(listener.start())
