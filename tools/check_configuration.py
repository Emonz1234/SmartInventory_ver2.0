"""Read-only preflight, prints no passwords/tokens/secrets."""
import argparse
import json
from pathlib import Path
import socket
import ssl
from dotenv import dotenv_values


def check(path, network=False):
    path = Path(path).resolve()
    if not path.is_file():
        return {'configuration_file': False}
    values = dotenv_values(path)
    edge = 'DEVICE_ID' in values
    required = ['DEVICE_ID', 'DB_PATH', 'EDGE_API_TOKEN', 'DEVICE_SECRET', 'MQTT_PASSWORD'] if edge else [
        'DJANGO_SECRET_KEY', 'DJANGO_ALLOWED_HOSTS', 'POSTGRES_PASSWORD', 'MQTT_PASSWORD']
    result = {key + '_configured': bool(values.get(key)) and not str(values[key]).startswith(('replace-', 'your-')) for key in required}
    host = values.get('MQTT_HOST', '')
    result['mqtt_client_host'] = bool(host and host not in ('0.0.0.0', '::'))
    if edge:
        result['device_type'] = values.get('DEVICE_TYPE') in ('IPC', 'IPCSIM')
        result['device_secret_length'] = len(values.get('DEVICE_SECRET') or '') >= 32
        result['serial_configured'] = bool(values.get('SERIAL_PORT')) or values.get('SERIAL_GROUP_PORTS', '{}') != '{}' or values.get('DEVICE_TYPE') == 'IPC'
    if network and result['mqtt_client_host']:
        try:
            with socket.create_connection((host, int(values.get('MQTT_PORT', '8883'))), timeout=3) as raw:
                if str(values.get('MQTT_TLS', '1')).lower() in ('1', 'true'):
                    ca = values.get('MQTT_CA')
                    context = ssl.create_default_context(cafile=str(path.parent / ca) if ca else None)
                    with context.wrap_socket(raw, server_hostname=host):
                        pass
                result['mqtt_tcp_tls_reachable'] = True
        except (OSError, ValueError):
            result['mqtt_tcp_tls_reachable'] = False
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', required=True)
    parser.add_argument('--network', action='store_true')
    args = parser.parse_args()
    result = check(args.env, args.network)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if all(result.values()) else 1)
