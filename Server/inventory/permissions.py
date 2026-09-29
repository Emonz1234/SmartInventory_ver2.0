from django.core.exceptions import PermissionDenied
from .models import RolePermission

PERMISSIONS = [
    "dashboard.view",
    "ipc.view",
    "ipc.manage",
    "cabinet.view",
    "cabinet.control",
    "environment.view",
    "alarm.view",
    "alarm.acknowledge",
    "inventory.view",
    "inventory.create",
    "inventory.update",
    "inventory.delete",
    "inventory.move",
    "user.view",
    "user.manage",
    "role.manage",
    "audit.view",
    "system.manage",
]
SOURCE_DOMAIN = {"REAL": "IPC", "SIMULATION": "IPCSIM"}


def source(domain):
    return "REAL" if domain == "IPC" else "SIMULATION"


def allowed(user, permission, scope):
    return user.is_active and (
        user.is_superuser
        or RolePermission.objects.filter(
            role__user=user, permission=permission, scope__in=[scope, "ALL"]
        ).exists()
    )


def require(user, permission, scope="ALL"):
    if not allowed(user, permission, scope):
        raise PermissionDenied("Permission or source scope denied")


def sources(request, permission):
    selected = request.GET.get("source_type", "REAL")
    if selected not in ("REAL", "SIMULATION", "ALL"):
        raise ValueError("Invalid source_type")
    values = list(SOURCE_DOMAIN) if selected == "ALL" else [selected]
    values = [s for s in values if allowed(request.user, permission, s)]
    if not values:
        raise PermissionDenied("Permission or source scope denied")
    return values
