from django.contrib import admin
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger, RuntimeEvent, Category, AuditLog, PhysicalTransaction


class AuditAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False
    def has_change_permission(self, request, obj=None):
        return False
    def has_delete_permission(self, request, obj=None):
        return False


class DeviceAdmin(AuditAdmin):
    exclude = ("snapshot",)


class PhysicalTransactionAdmin(AuditAdmin):
    exclude = ('payload',)
    list_display = ('transaction_id', 'device', 'status', 'applied_revision', 'error', 'received_at')
    list_filter = ('status', 'device')


admin.site.register(PhysicalTransaction, PhysicalTransactionAdmin)


admin.site.register(Device, DeviceAdmin)
for model in [Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger, RuntimeEvent, Category, AuditLog]:
    admin.site.register(model, AuditAdmin)
