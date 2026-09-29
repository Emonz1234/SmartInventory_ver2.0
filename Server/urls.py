from django.contrib import admin
from django.urls import path
from .inventory import views

urlpatterns = [path("admin/", admin.site.urls), path("api/session", views.session),
    path("api/devices", views.devices), path("api/assignments", views.assignments),
    path("api/inventory", views.inventory), path("api/operations", views.operations),
    path("api/operations/<uuid:operation_id>/confirm", views.confirm), path("api/ledger", views.ledger),
    path("api/events", views.events), path('api/audit', views.audit)]
urlpatterns += [path(f"api/{name}", views.resources, {"resource": name}) for name in views.RESOURCES]

from .inventory.console import console
urlpatterns += [path('api/' + name, console, {'resource':name}) for name in [
    'dashboard', 'ipcs', 'cabinet-groups', 'rack-status', 'environment', 'alarms', 'goods',
    'storage-locations', 'inventory-transactions', 'users', 'roles', 'permissions', 'audit-logs', 'settings']]
urlpatterns += [path('api/ipcs/<str:pk>', console, {'resource':'ipcs'}),
    path('api/racks/<int:pk>/commands', console, {'resource':'commands'}),
    path('api/alarms/<int:pk>/acknowledge', console, {'resource':'alarms'})]
