"""One FastAPI/Serial/MQTT process serving the shared React operator UI."""
import argparse
import os
from pathlib import Path


def main(device_type):
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', help='Instance .env path; relative paths in it resolve from its directory')
    parser.add_argument('--headless', action='store_true', help='Compatibility flag; the API always serves React at /ui/')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    env_file = Path(args.env).resolve() if args.env else root / device_type / '.env'
    if not env_file.is_file():
        parser.error(f'Configuration missing: {env_file}. Copy the instance .env.example first.')
    os.environ['EDGE_ENV_FILE'] = str(env_file)
    os.environ.setdefault('DEVICE_TYPE', device_type)
    os.chdir(env_file.parent)
    from ipc_core.app.core.config import settings
    settings.require_identity()
    if settings.DEVICE_TYPE != device_type:
        parser.error(f'This launcher requires DEVICE_TYPE={device_type}')
    print(f'React UI: http://{settings.EDGE_API_HOST}:{settings.EDGE_API_PORT}/ui/')
    import uvicorn
    uvicorn.run('ipc_core.api:app', host=settings.EDGE_API_HOST, port=settings.EDGE_API_PORT)
