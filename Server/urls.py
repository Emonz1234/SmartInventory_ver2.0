from django.contrib import admin
from django.urls import path
from .inventory import views

urlpatterns = [path("admin/", admin.site.urls), path("api/session", views.session),
    path("api/devices", views.devices), path("api/assignments", views.assignments),
    path("api/inventory", views.inventory), path("api/operations", views.operations),
    path("api/operations/<uuid:operation_id>/confirm", views.confirm), path("api/ledger", views.ledger),
    path("api/events", views.events), path('api/audit', views.audit)]
urlpatterns += [path(f"api/{name}", views.resources, {"resource": name}) for name in views.RESOURCES]
