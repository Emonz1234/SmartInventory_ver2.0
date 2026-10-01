from pathlib import Path
import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=os.environ.get("EDGE_ENV_FILE", ".env"), extra="ignore")
    APP_NAME: str = "Smart Inventory Edge"
    DEVICE_ID: str = ""
    DEVICE_TYPE: str = "IPCSIM"
    DB_PATH: str = ""
    SERIAL_PORT: str = ""
    SERIAL_GROUP_PORTS: dict[int, str] = {}
    SERIAL_BAUDRATE: int = 9600

    MQTT_HOST: str = ""
    MQTT_PORT: int = 8883
    MQTT_PASSWORD: str = ""
    MQTT_CA: str = ""
    MQTT_TLS: bool = True
    EDGE_API_TOKEN: str = ""
    EDGE_API_HOST: str = "127.0.0.1"
    EDGE_API_PORT: int = 8000
    SERVER_URL: str = ""
    HARDWARE_ENABLED: bool = False

    def require_identity(self):
        from ipc_core.protocol import valid_id
        if not valid_id(self.DEVICE_ID) or not self.DB_PATH:
            raise ValueError("Set unique DEVICE_ID and an independent DB_PATH")
        if self.DEVICE_TYPE not in {"IPC", "IPCSIM"}:
            raise ValueError("DEVICE_TYPE must be IPC or IPCSIM")
        if self.SERIAL_GROUP_PORTS:
            from Simulation.topology import GROUP_COUNT
            ports = self.SERIAL_GROUP_PORTS
            if self.DEVICE_TYPE != 'IPCSIM' or self.SERIAL_PORT or any(k < 1 or k > GROUP_COUNT or not v for k, v in ports.items()) or len(set(ports.values())) != len(ports):
                raise ValueError('SERIAL_GROUP_PORTS requires IPCSIM, unique ports, groups 1..21 and empty SERIAL_PORT')
        if not self.EDGE_API_TOKEN:
            raise ValueError("EDGE_API_TOKEN is required")
        if self.SERVER_URL:
            from urllib.parse import urlsplit
            url = urlsplit(self.SERVER_URL)
            if url.scheme not in {'http', 'https'} or not url.netloc or url.username or url.password:
                raise ValueError('SERVER_URL must be an http(s) origin without credentials')
        if self.MQTT_HOST and not self.MQTT_PASSWORD:
            raise ValueError("MQTT_PASSWORD is required")
        Path(self.DB_PATH).resolve().parent.mkdir(parents=True, exist_ok=True)


settings = Settings()
