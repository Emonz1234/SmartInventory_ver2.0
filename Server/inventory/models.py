import uuid
from django.db import models
from django.db.models import Q

TYPES = [("IPC", "Physical"), ("IPCSIM", "Simulation")]


class Device(models.Model):
    device_id = models.CharField(max_length=64, primary_key=True)
    device_type = models.CharField(max_length=6, choices=TYPES)
    name = models.CharField(max_length=120)
    secret = models.CharField(max_length=128)
    enabled = models.BooleanField(default=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    serial_connected = models.BooleanField(default=False)
    revision = models.PositiveBigIntegerField(default=0)
    acknowledged_revision = models.PositiveBigIntegerField(default=0)
    snapshot = models.JSONField(default=list)


class Cabinet(models.Model):
    code = models.CharField(max_length=64)
    name = models.CharField(max_length=120)
    domain = models.CharField(max_length=6, choices=TYPES)
    device = models.ForeignKey(Device, null=True, blank=True, on_delete=models.PROTECT)
    group = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)
    topology_locked = models.BooleanField(default=False)
    configuration_status = models.CharField(max_length=32, default='pending')

    class Meta:
        constraints = [models.UniqueConstraint(fields=["domain", "code"], name="cabinet_domain_code")]


class Rack(models.Model):
    cabinet = models.ForeignKey(Cabinet, on_delete=models.PROTECT)
    address = models.PositiveIntegerField()
    name = models.CharField(max_length=120, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["cabinet", "address"], name="cabinet_rack_address")]


class Shelf(models.Model):
    rack = models.ForeignKey(Rack, on_delete=models.PROTECT)
    code = models.CharField(max_length=64)
    level = models.PositiveIntegerField(default=1)


class Bin(models.Model):
    shelf = models.ForeignKey(Shelf, on_delete=models.PROTECT)
    code = models.CharField(max_length=64)
    capacity = models.PositiveIntegerField(default=0)


class Category(models.Model):
    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)


class Item(models.Model):
    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=32)
    min_qty = models.PositiveIntegerField(default=0)
    max_qty = models.PositiveIntegerField(default=0)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_demo = models.BooleanField(default=False)


class Stock(models.Model):
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    bin = models.ForeignKey(Bin, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["item", "bin"], name="stock_item_bin"),
                       models.CheckConstraint(condition=Q(quantity__gte=0), name="stock_nonnegative")]


class Operation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(Device, on_delete=models.PROTECT)
    item = models.ForeignKey(Item, on_delete=models.PROTECT, null=True, blank=True)
    bin = models.ForeignKey(Bin, on_delete=models.PROTECT, null=True, blank=True)
    rack = models.ForeignKey(Rack, on_delete=models.PROTECT)
    kind = models.CharField(max_length=16)
    quantity = models.PositiveIntegerField(default=0)
    state = models.CharField(max_length=32, default="queued")
    execution_state = models.CharField(max_length=32, default="awaiting_device")
    execution_updated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    requested_by = models.ForeignKey("auth.User", on_delete=models.PROTECT, related_name="requested_operations")
    confirmed_by = models.ForeignKey("auth.User", on_delete=models.PROTECT, null=True, related_name="confirmed_operations")
    confirmation_note = models.TextField(blank=True)
    request_key = models.CharField(max_length=64, unique=True)


class Ledger(models.Model):
    operation = models.OneToOneField(Operation, on_delete=models.PROTECT)
    delta = models.IntegerField()
    quantity_after = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class Outbox(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(Device, on_delete=models.CASCADE)
    channel = models.CharField(max_length=16)
    body = models.JSONField()
    attempts = models.PositiveIntegerField(default=0)
    sent_at = models.DateTimeField(null=True)
    acknowledged = models.BooleanField(default=False)


class Receipt(models.Model):
    device = models.ForeignKey(Device, on_delete=models.CASCADE)
    message_id = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["device", "message_id"], name="receipt_device_message")]


class RuntimeEvent(models.Model):
    device = models.ForeignKey(Device, on_delete=models.PROTECT)
    message_id = models.CharField(max_length=64)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)


class LegacyImport(models.Model):
    digest = models.CharField(max_length=64, unique=True)
    domain = models.CharField(max_length=6, choices=TYPES)
    archive = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)


class AuditLog(models.Model):
    actor = models.ForeignKey('auth.User', null=True, on_delete=models.PROTECT)
    action = models.CharField(max_length=64)
    resource = models.CharField(max_length=64)
    object_id = models.CharField(max_length=64)
    before = models.JSONField(default=dict)
    after = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
