from concurrent.futures import ThreadPoolExecutor
import threading
from django.db import connection, close_old_connections
from django.test import TransactionTestCase, skipUnlessDBFeature
from django.contrib.auth import get_user_model
from django.utils import timezone
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger
from .services import confirm_operation


class ConcurrentConfirmation(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_two_confirmations_post_one_ledger_entry(self):
        user = get_user_model().objects.create_user("checker")
        device = Device.objects.create(device_id="physical", device_type="IPC", name="physical", secret="s"*48)
        cabinet = Cabinet.objects.create(code="c", name="c", domain="IPC", device=device)
        rack = Rack.objects.create(cabinet=cabinet, address=1)
        shelf = Shelf.objects.create(rack=rack, code="s")
        bin_obj = Bin.objects.create(shelf=shelf, code="b")
        item = Item.objects.create(code="i", name="i", unit="piece")
        stock = Stock.objects.create(item=item, bin=bin_obj, quantity=10)
        op = Operation.objects.create(device=device, item=item, bin=bin_obj, rack=rack, kind="PICK", quantity=2,
            state="sent", requested_by=user, request_key="concurrent", expires_at=timezone.now())
        barrier = threading.Barrier(2)
        def confirm():
            close_old_connections()
            try:
                barrier.wait(timeout=5)
                return confirm_operation(user, op.pk, "Counted two pieces").state
            finally:
                connection.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: confirm(), range(2)))
        self.assertEqual(results, ["confirmed", "confirmed"])
        stock.refresh_from_db()
        self.assertEqual(stock.quantity, 8)
        self.assertEqual(Ledger.objects.count(), 1)
