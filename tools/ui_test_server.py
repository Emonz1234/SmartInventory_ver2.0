"""Ephemeral UI test DB. Requires the dedicated local PostgreSQL test cluster."""
import os
import sys
import uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import psycopg
from psycopg import sql

name = "ui_test_"+uuid.uuid4().hex[:12]
os.environ.update(POSTGRES_HOST="127.0.0.1",POSTGRES_PORT="55440",POSTGRES_USER="inventory_test",
                  POSTGRES_DB=name,DJANGO_SECRET_KEY="ephemeral-ui-test-key",DJANGO_SETTINGS_MODULE="Server.settings",
                  DJANGO_CSRF_TRUSTED_ORIGINS="http://127.0.0.1:3100")
with psycopg.connect(host="127.0.0.1",port=55440,user="inventory_test",dbname="postgres",autocommit=True) as c:
    c.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
import django
django.setup()
from django.core.management import call_command
from django.contrib.auth import get_user_model
call_command("migrate",verbosity=0)
get_user_model().objects.create_superuser("ui-test", "", "test-only-password")
with Path(".tools/ui-db-names.txt").open("a") as f:
    f.write(name+"\n")
Path(".tools/ui-server.pid").write_text(str(os.getpid()))
call_command("runserver","127.0.0.1:8001",noreload=True,use_threading=True)
