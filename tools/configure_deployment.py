"""Create fresh deployment configuration without overwriting existing secrets."""
import argparse
from pathlib import Path
import secrets
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True, help='Client-reachable hostname or LAN IP, not 0.0.0.0')
    parser.add_argument('--lan', action='store_true', help='Bind to all interfaces on a trusted LAN/VPN; plaintext MQTT')
    args = parser.parse_args()
    if args.host in ('0.0.0.0', '::') or any(c in args.host for c in '/\n\r@ :'):
        parser.error('Supply a reachable hostname/IPv4 address only')
    root = Path(__file__).resolve().parents[1] / 'deploy'
    target = root / '.env'
    directory = root / 'secrets'
    if target.exists() or (directory / 'passwords').exists():
        parser.error('Existing configuration found; refusing to overwrite credentials')
    directory.mkdir(exist_ok=True)
    mqtt_password = secrets.token_urlsafe(36)
    content = (root / '.env.example').read_text(encoding='utf-8')
    values = {'DJANGO_SECRET_KEY': secrets.token_urlsafe(48), 'POSTGRES_PASSWORD': secrets.token_urlsafe(36),
              'MQTT_PASSWORD': mqtt_password, 'DJANGO_ALLOWED_HOSTS': f'localhost,127.0.0.1,{args.host}',
              'DJANGO_CSRF_TRUSTED_ORIGINS': f'http://{args.host}:8080,http://localhost:8080'}
    if args.lan:
        values.update(BIND_ADDRESS='0.0.0.0', MQTT_TLS='0', MQTT_CONFIG='mosquitto.lan.conf')
    for key, value in values.items():
        content = '\n'.join(f'{key}={value}' if line.startswith(key + '=') else line for line in content.split('\n'))
    # mosquitto_passwd produces the broker's salted password hash; plaintext remains only in .env.
    try:
        subprocess.run(['docker', 'run', '--rm', '-v', f'{directory}:/secrets', 'eclipse-mosquitto:2',
                        'mosquitto_passwd', '-b', '-c', '/secrets/passwords', 'inventory-server', mqtt_password], check=True)
    except (OSError, subprocess.CalledProcessError):
        parser.error('Broker password generation failed. Check Docker availability; no .env was written.')
    target.write_text(content, encoding='utf-8')
    print('Created deploy/.env and secrets/passwords. Provision TLS files before using the default TLS profile.')


if __name__ == '__main__':
    main()
