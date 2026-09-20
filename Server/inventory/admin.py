from django.contrib import admin
from .models import Device, Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger, RuntimeEvent, Category, AuditLog


class AuditAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False
    def has_change_permission(self, request, obj=None):
        return False
    def has_delete_permission(self, request, obj=None):
        return False


class DeviceAdmin(AuditAdmin):
    exclude = ("secret",)


admin.site.register(Device, DeviceAdmin)
for model in [Cabinet, Rack, Shelf, Bin, Item, Stock, Operation, Ledger, RuntimeEvent, Category, AuditLog]:
    admin.site.register(model, AuditAdmin)
