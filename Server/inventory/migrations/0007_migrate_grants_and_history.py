from django.db import migrations

# Translate existing grants once; runtime authorization never checks role names.
MAPPING = {
    "view_device": ["ipc.view", "dashboard.view"],
    "add_device": ["ipc.manage"],
    "change_device": ["ipc.manage"],
    "view_cabinet": ["cabinet.view"],
    "view_rack": ["cabinet.view"],
    "change_cabinet": ["ipc.manage"],
    "add_cabinet": ["ipc.manage"],
    "add_rack": ["ipc.manage"],
    "change_rack": ["ipc.manage"],
    "view_stock": ["inventory.view"],
    "view_item": ["inventory.view"],
    "view_bin": ["inventory.view"],
    "view_category": ["inventory.view"],
    "view_shelf": ["inventory.view"],
    "view_ledger": ["inventory.view"],
    "add_item": ["inventory.create"],
    "add_category": ["inventory.create"],
    "add_bin": ["inventory.create"],
    "add_shelf": ["inventory.create"],
    "change_item": ["inventory.update"],
    "change_category": ["inventory.update"],
    "change_bin": ["inventory.update"],
    "change_shelf": ["inventory.update"],
    "delete_item": ["inventory.delete"],
    "delete_category": ["inventory.delete"],
    "delete_bin": ["inventory.delete"],
    "delete_shelf": ["inventory.delete"],
    "view_runtimeevent": ["environment.view", "alarm.view"],
    "view_operation": ["cabinet.view"],
    "add_operation": ["cabinet.control", "inventory.move"],
    "change_operation": ["cabinet.control", "inventory.move", "alarm.acknowledge"],
    "view_auditlog": ["audit.view"],
    "view_user": ["user.view"],
    "change_user": ["user.manage"],
    "add_user": ["user.manage"],
    "change_group": ["role.manage"],
    "add_group": ["role.manage"],
}


def forward(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    User = apps.get_model("auth", "User")
    Grant = apps.get_model("inventory", "RolePermission")
    for group in Group.objects.all():
        for p in group.permissions.filter(
            content_type__app_label__in=["inventory", "auth"]
        ):
            for permission in MAPPING.get(p.codename, []):
                Grant.objects.get_or_create(
                    role=group, permission=permission, scope="ALL"
                )
    for user in User.objects.filter(user_permissions__isnull=False).distinct():
        group, _ = Group.objects.get_or_create(name=f"Migrated user grants #{user.pk}")
        user.groups.add(group)
        for p in user.user_permissions.filter(
            content_type__app_label__in=["inventory", "auth"]
        ):
            for permission in MAPPING.get(p.codename, []):
                Grant.objects.get_or_create(
                    role=group, permission=permission, scope="ALL"
                )
    Entry = apps.get_model("inventory", "InventoryTransaction")
    Ledger = apps.get_model("inventory", "Ledger")
    for ledger in Ledger.objects.select_related("operation__device").iterator():
        op = ledger.operation
        if not op.item_id or op.kind not in ["PUT", "PICK", "ADJUST"]:
            continue
        Entry.objects.get_or_create(
            operation_id=op.pk,
            defaults=dict(
                item_id=op.item_id,
                source_type="REAL" if op.device.device_type == "IPC" else "SIMULATION",
                kind={"PUT": "INBOUND", "PICK": "OUTBOUND", "ADJUST": "ADJUST"}[
                    op.kind
                ],
                quantity=op.quantity,
                from_location_id=op.bin_id if op.kind == "PICK" else None,
                to_location_id=op.bin_id if op.kind != "PICK" else None,
                actor_id=op.confirmed_by_id or op.requested_by_id,
                note=op.confirmation_note,
                request_key="operation-" + str(op.pk),
            ),
        )
        Entry.objects.filter(operation_id=op.pk).update(created_at=ledger.created_at)


class Migration(migrations.Migration):
    dependencies = [("inventory", "0006_server_console")]
    operations = [migrations.RunPython(forward, migrations.RunPython.noop)]
