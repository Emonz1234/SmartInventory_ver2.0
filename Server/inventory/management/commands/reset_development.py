import os
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = 'Drop only the local development application schema; migrate and seed separately.'

    def add_arguments(self, parser):
        parser.add_argument('--confirm-development-reset', action='store_true')

    def handle(self, *args, **options):
        database = connection.settings_dict
        local_hosts = {'localhost', '127.0.0.1'}
        if not options['confirm_development_reset'] or os.environ.get('ALLOW_DEVELOPMENT_DATA_RESET') != '1':
            raise CommandError('Requires --confirm-development-reset and ALLOW_DEVELOPMENT_DATA_RESET=1.')
        if (database['ENGINE'] != 'django.db.backends.postgresql'
                or database['HOST'] != 'postgres' or database['NAME'] != 'inventory'
                or not set(settings.ALLOWED_HOSTS) <= local_hosts):
            raise CommandError('Refusing reset: this command only targets the local Compose inventory database.')

        owner = connection.ops.quote_name(database['USER'])
        with connection.cursor() as cursor:
            cursor.execute('DROP SCHEMA public CASCADE')
            cursor.execute(f'CREATE SCHEMA public AUTHORIZATION {owner}')
        connection.close()
        self.stdout.write(self.style.WARNING('Dropped only the public schema in local database inventory. Run migrate, then seed_demo_data.'))