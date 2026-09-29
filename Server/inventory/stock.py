"""Official stock movements, serialized with the existing device/snapshot writers."""

from django.db import transaction
from django.db.models import Sum
from .models import Device, Bin, Stock, Item, InventoryTransaction, AuditLog, Operation
from .permissions import require, source
from .services import refresh


@transaction.atomic
def transact(user, data):
    devices = list(Device.objects.select_for_update().order_by("pk"))
    kind, qty = data["kind"], data["quantity"]
    if (
        kind not in dict(InventoryTransaction.TYPES)
        or type(qty) is not int
        or qty < 0
        or (kind != "ADJUST" and qty == 0)
    ):
        raise ValueError("Invalid transaction type or quantity")
    if (
        not isinstance(data.get("request_key"), str)
        or not 1 <= len(data["request_key"]) <= 64
    ):
        raise ValueError("request_key required (maximum 64 characters)")
    if not str(data.get("note", "")).strip():
        raise ValueError("Record evidence of the physical stock movement")
    item = Item.objects.get(pk=data["item_id"], is_active=True)
    list(
        Bin.objects.select_for_update()
        .filter(
            pk__in=[
                v
                for v in [data.get("from_location_id"), data.get("to_location_id")]
                if v is not None
            ]
        )
        .order_by("pk")
    )
    origin = (
        Bin.objects.select_related("shelf__rack__cabinet").get(
            pk=data["from_location_id"]
        )
        if data.get("from_location_id")
        else None
    )
    target = (
        Bin.objects.select_related("shelf__rack__cabinet").get(
            pk=data["to_location_id"]
        )
        if data.get("to_location_id")
        else None
    )
    if (kind in ["OUTBOUND", "BORROW", "MOVE"]) != bool(origin) or (
        kind in ["INBOUND", "RETURN", "MOVE", "ADJUST"]
    ) != bool(target):
        raise ValueError("Invalid origin/destination for transaction")
    scope = source((origin or target).shelf.rack.cabinet.domain)
    require(user, "inventory.move", scope)
    if data.get("source_type", scope) != scope or (
        origin and target and source(target.shelf.rack.cabinet.domain) != scope
    ):
        raise ValueError("Cannot move stock across REAL/SIMULATION")
    if origin == target:
        raise ValueError("Origin and destination must differ")
    signature = dict(
        item_id=item.pk,
        kind=kind,
        quantity=qty,
        from_location_id=origin.pk if origin else None,
        to_location_id=target.pk if target else None,
        source_type=scope,
        borrow_id=data.get("borrow_id"),
    )
    previous = InventoryTransaction.objects.filter(
        request_key=data["request_key"]
    ).first()
    if previous:
        if any(getattr(previous, k) != v for k, v in signature.items()):
            raise ValueError("Idempotency key reused with different transaction")
        return previous
    if kind == "RETURN":
        loan = InventoryTransaction.objects.get(
            pk=data.get("borrow_id"), kind="BORROW", item=item, source_type=scope
        )
        returned = (
            InventoryTransaction.objects.filter(borrow=loan).aggregate(
                n=Sum("quantity")
            )["n"]
            or 0
        )
        if returned + qty > loan.quantity:
            raise ValueError("Return exceeds outstanding borrowed quantity")
    elif data.get("borrow_id"):
        raise ValueError("borrow_id is only valid for RETURN")
    before, after = {}, {}
    for location, delta in [(origin, -qty), (target, qty)]:
        if location is None:
            continue
        if (
            Operation.objects.filter(bin=location)
            .exclude(state__in=["confirmed", "failed", "cancelled"])
            .exists()
        ):
            raise ValueError("Resolve pending device operation at this location first")
        stock, _ = Stock.objects.get_or_create(item=item, bin=location)
        before[str(location.pk)] = stock.quantity
        quantity = qty if kind == "ADJUST" else stock.quantity + delta
        if quantity < 0:
            raise ValueError("Insufficient stock")
        total = (
            Stock.objects.filter(bin=location).aggregate(n=Sum("quantity"))["n"] or 0
        )
        if quantity > stock.quantity and (
            location.reserved
            or (
                location.capacity
                and total + quantity - stock.quantity > location.capacity
            )
        ):
            raise ValueError("Location reserved or capacity exceeded")
        stock.quantity = quantity
        stock.save(update_fields=["quantity"])
        after[str(location.pk)] = quantity
    entry = InventoryTransaction.objects.create(
        **signature, actor=user, note=data["note"], request_key=data["request_key"]
    )
    AuditLog.objects.create(
        actor=user,
        action=kind,
        resource="inventory-transaction",
        object_id=str(entry.pk),
        source_type=scope,
        before=before,
        after=after,
    )
    for device in devices:
        refresh(device)
    return entry
