from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from ipc_core.protocol import envelope, encode, topic
from .models import Device, Outbox, Receipt
from .mqtt import receive
from .services import queue


class BackpressureTests(TestCase):
    def setUp(self):
        self.device = Device.objects.create(device_id='sim-backlog', device_type='IPCSIM',
                                            name='Backlog', secret='x' * 48)

    def test_repeated_heartbeat_has_one_ack_and_can_reack_after_delivery(self):
        msg = envelope(self.device.pk, 'IPCSIM', 'status.heartbeat', {'serial_connected': True})
        route, raw = topic(self.device.pk, 'up', 'status'), encode(msg, self.device.secret)
        for _ in range(10):
            receive(route, raw)
        self.assertEqual(Receipt.objects.count(), 1)
        ack = Outbox.objects.get(channel='ack')
        ack.acknowledged = True
        ack.sent_at = timezone.now()
        ack.save()
        receive(route, raw)
        ack.refresh_from_db()
        self.assertFalse(ack.acknowledged)
        self.assertIsNone(ack.sent_at)
        self.assertEqual(Outbox.objects.filter(channel='ack').count(), 1)

    def test_latest_lease_supersedes_pending_lease(self):
        for _ in range(3):
            queue(self.device, 'status', 'status.lease',
                  {'expires_at': (timezone.now() + timedelta(seconds=35)).isoformat(), 'revision': 1})
        self.assertEqual(Outbox.objects.filter(channel='status', acknowledged=False).count(), 1)

    def test_stale_heartbeat_does_not_grant_online_lease(self):
        msg = envelope(self.device.pk, 'IPCSIM', 'status.heartbeat', {})
        msg['timestamp'] = (timezone.now() - timedelta(minutes=5)).isoformat()
        receive(topic(self.device.pk, 'up', 'status'), encode(msg, self.device.secret))
        self.device.refresh_from_db()
        self.assertIsNone(self.device.last_seen)
        self.assertFalse(Outbox.objects.filter(channel='status').exists())
