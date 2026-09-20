"""Create a local CA and broker certificate. Keep ca.key on the Server machine."""
import argparse
import ipaddress
from pathlib import Path
import re
import subprocess


def create(host, directory):
    if not re.fullmatch(r'[a-zA-Z0-9.-]+', host):
        raise ValueError('Expected a DNS hostname or IPv4 address')
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if any((directory / name).exists() for name in ('ca.key', 'ca.crt', 'server.key', 'server.crt')):
        raise ValueError('Refusing to overwrite an existing certificate/key')
    try:
        ipaddress.ip_address(host)
        name = 'IP:' + host
    except ValueError:
        name = 'DNS:' + host
    (directory / 'server.ext').write_text('subjectAltName=DNS:mqtt,DNS:localhost,IP:127.0.0.1,' + name +
                                         '\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n', encoding='ascii')
    (directory / 'openssl.cnf').write_text('[req]\ndistinguished_name=dn\n[dn]\n[v3_ca]\n'
        'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n', encoding='ascii')
    commands = [
        ['req', '-config', 'openssl.cnf', '-extensions', 'v3_ca', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '365', '-subj', '/CN=SmartInventory Local CA', '-keyout', 'ca.key', '-out', 'ca.crt'],
        ['req', '-config', 'openssl.cnf', '-newkey', 'rsa:3072', '-nodes', '-subj', '/CN=' + host, '-keyout', 'server.key', '-out', 'server.csr'],
        ['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '365', '-extfile', 'server.ext'],
    ]
    for command in commands:
        subprocess.run(['openssl', *command], cwd=directory, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    print('Created CA and broker certificate; distribute only ca.crt to edge machines.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True)
    parser.add_argument('--output', default='deploy/secrets')
    args = parser.parse_args()
    create(args.host, args.output)
