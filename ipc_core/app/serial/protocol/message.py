from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class SerialMessage:
    msg_type: str
    payload: Dict[str, Any]