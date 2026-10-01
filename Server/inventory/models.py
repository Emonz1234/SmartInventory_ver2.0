import uuid
from django.db import models
from django.db.models import Q

TYPES = [("IPC", "Physical"), ("IPCSIM", "Simulation")]


class Device(models.Model):
    device_id = models.CharField(max_length=64, primary_key=True)
    device_type = models.CharField(max_length=6, choices=TYPES)
    name = models.CharField(max_length=120)
    enabled = models.BooleanField(default=True)
    last_seen = models.DateTimeField(null=True, blank=True)
    serial_connected = models.BooleanField(default=False)
    revision = models.PositiveBigIntegerField(default=0)
    acknowledged_revision = models.PositiveBigIntegerField(default=0)
    snapshot = models.JSONField(default=list)
    last_sync = models.DateTimeField(null=True, blank=True)


class Cabinet(models.Model):
    code = models.CharField(max_length=64)
    name = models.CharField(max_length=120)
    domain = models.CharField(max_length=6, choices=TYPES)
    device = models.ForeignKey(Device, null=True, blank=True, on_delete=models.PROTECT)
    group = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)
    topology_locked = models.BooleanField(default=False)
    configuration_status = models.CharField(max_length=32, default='pending')
    area = models.CharField(max_length=120, blank=True)

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

    class Meta:
        constraints = [models.UniqueConstraint(fields=['rack', 'code'], name='shelf_rack_code')]


class Bin(models.Model):
    shelf = models.ForeignKey(Shelf, on_delete=models.PROTECT)
    code = models.CharField(max_length=64)
    capacity = models.PositiveIntegerField(default=0)
    reserved = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['shelf', 'code'], name='bin_shelf_code')]


class Category(models.Model):
    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)


class Item(models.Model):
    barcode = models.CharField(max_length=64, blank=True, db_index=True)
    code = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=120)
    unit = models.CharField(max_length=32)
    min_qty = models.PositiveIntegerField(default=0)
    max_qty = models.PositiveIntegerField(default=0)
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.PROTECT)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_demo = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['barcode'], condition=~Q(barcode=''), name='item_barcode_unique_nonblank')]


class Stock(models.Model):
    updated_at = models.DateTimeField(auto_now=True)
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
    source_type = models.CharField(max_length=10, default='ALL')
    result = models.CharField(max_length=32, default='success')


SOURCES = [('REAL', 'Real'), ('SIMULATION', 'Simulation')]


class RolePermission(models.Model):
    role = models.ForeignKey('auth.Group', on_delete=models.CASCADE)
    permission = models.CharField(max_length=64)
    scope = models.CharField(max_length=10, choices=SOURCES + [('ALL', 'All')])

    class Meta:
        constraints = [models.UniqueConstraint(fields=['role', 'permission', 'scope'], name='role_permission_scope')]


class RackStatus(models.Model):
    rack = models.OneToOneField(Rack, on_delete=models.CASCADE)
    values = models.JSONField(default=dict)
    updated_at = models.DateTimeField()


class EnvironmentStatus(models.Model):
    rack = models.ForeignKey(Rack, on_delete=models.PROTECT)
    device = models.ForeignKey(Device, on_delete=models.PROTECT)
    source_type = models.CharField(max_length=10, choices=SOURCES)
    values = models.JSONField()
    created_at = models.DateTimeField(db_index=True)


class Alarm(models.Model):
    rack = models.ForeignKey(Rack, on_delete=models.PROTECT)
    device = models.ForeignKey(Device, on_delete=models.PROTECT)
    source_type = models.CharField(max_length=10, choices=SOURCES)
    code = models.CharField(max_length=64)
    severity = models.CharField(max_length=16)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField()
    cleared_at = models.DateTimeField(null=True)
    acknowledged_at = models.DateTimeField(null=True)
    acknowledged_by = models.ForeignKey('auth.User', null=True, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['rack', 'code'], condition=Q(active=True), name='one_active_alarm')]


class InventoryTransaction(models.Model):
    TYPES = [(s, s) for s in ['INBOUND', 'OUTBOUND', 'MOVE', 'BORROW', 'RETURN', 'ADJUST']]
    item = models.ForeignKey(Item, on_delete=models.PROTECT)
    source_type = models.CharField(max_length=10, choices=SOURCES)
    kind = models.CharField(max_length=10, choices=TYPES)
    quantity = models.PositiveIntegerField()
    from_location = models.ForeignKey(Bin, null=True, on_delete=models.PROTECT, related_name='outgoing')
    to_location = models.ForeignKey(Bin, null=True, on_delete=models.PROTECT, related_name='incoming')
    actor = models.ForeignKey('auth.User', on_delete=models.PROTECT)
    note = models.TextField()
    request_key = models.CharField(max_length=64, unique=True)
    borrow = models.ForeignKey('self', null=True, on_delete=models.PROTECT)
    operation = models.OneToOneField(Operation, null=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(source_type__in=['REAL', 'SIMULATION']), name='transaction_valid_source'),
            models.CheckConstraint(condition=Q(quantity__gt=0) | Q(kind='ADJUST'), name='transaction_positive_quantity'),
            models.CheckConstraint(condition=(
                Q(kind__in=['INBOUND', 'RETURN', 'ADJUST'], from_location__isnull=True, to_location__isnull=False)
                | Q(kind__in=['OUTBOUND', 'BORROW'], from_location__isnull=False, to_location__isnull=True)
                | Q(kind='MOVE', from_location__isnull=False, to_location__isnull=False)
            ), name='transaction_location_shape'),
        ]


class PhysicalTransaction(models.Model):
    """Immutable edge evidence, retained even when reconciliation conflicts."""
    transaction_id = models.UUIDField(primary_key=True)
    device = models.ForeignKey(Device, on_delete=models.PROTECT)
    digest = models.CharField(max_length=64)
    payload = models.JSONField()
    status = models.CharField(max_length=16, default='PENDING')
    error = models.TextField(blank=True)
    applied_revision = models.PositiveBigIntegerField(null=True)
    received_at = models.DateTimeField(auto_now_add=True)


class SystemSetting(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    value = models.FloatField()
