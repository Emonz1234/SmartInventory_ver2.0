from .serial_manager import SerialManager, GroupSerialManager
from ..core.config import settings

serial_manager = GroupSerialManager(settings.SERIAL_GROUP_PORTS) if settings.SERIAL_GROUP_PORTS else SerialManager()
