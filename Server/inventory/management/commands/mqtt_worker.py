from django.core.management.base import BaseCommand
from Server.inventory.mqtt import run_worker


class Command(BaseCommand):
    help = "Run the durable MQTT dispatcher (one instance per Server)"
    def handle(self, **options):
        run_worker()
