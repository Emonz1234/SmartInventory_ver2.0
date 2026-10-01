"""Local-only demo server with a resettable, isolated PostgreSQL database.

Requires the workspace test PostgreSQL cluster on 127.0.0.1:55439.
Never reads the deployed database credentials and never starts an MQTT worker.
"""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.update(POSTGRES_HOST='127.0.0.1', POSTGRES_PORT='55439', POSTGRES_USER='inventory_test',
    POSTGRES_PASSWORD='', POSTGRES_DB='inventory_demo_server_ui', DJANGO_DEBUG='1',
    DJANGO_SECRET_KEY='local-inventory-demo-only', DJANGO_SETTINGS_MODULE='Server.settings',
    DJANGO_ALLOWED_HOSTS='localhost,127.0.0.1', DJANGO_CSRF_TRUSTED_ORIGINS='http://127.0.0.1:3100',
    SERVER_TEST_SQLITE='0', DJANGO_SECURE_COOKIES='0')
import psycopg
with psycopg.connect(host='127.0.0.1', port=55439, user='inventory_test', dbname='postgres', autocommit=True) as conn:
    conn.execute('DROP DATABASE IF EXISTS inventory_demo_server_ui WITH (FORCE)')
    conn.execute('CREATE DATABASE inventory_demo_server_ui')
import django
django.setup()
from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db import close_old_connections
from Server.inventory.models import Device
from threading import Thread, Event
call_command('migrate', verbosity=0)
call_command('seed_demo_data', allow_demo=True, isolated_fixture=True)
user, created = get_user_model().objects.get_or_create(username='inventory-demo', defaults={'is_staff':True,'is_superuser':True})
if created:
    user.set_password('local-demo-only-2026')
    user.save()
print('Demo DB: inventory_demo_server_ui; login: inventory-demo / local-demo-only-2026', flush=True)
stop = Event()
def demo_heartbeat():
    while not stop.is_set():
        close_old_connections()
        Device.objects.filter(pk__in=['IPC01','IPCSIM01']).update(last_seen=timezone.now())
        stop.wait(15)
Thread(target=demo_heartbeat, daemon=True).start()
try:
    call_command('runserver', '127.0.0.1:8001', use_reloader=False)
finally:
    stop.set()
