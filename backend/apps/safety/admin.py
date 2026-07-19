from django.contrib import admin

from .models import (
    AuditEvent,
    CareNotification,
    EscalationPolicy,
    EscalationStep,
    NotificationDelivery,
    NotificationPreference,
    PushSubscription,
    WorkerHeartbeat,
)


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "action", "patient", "actor", "summary")
    list_filter = ("action", "entity_type")
    readonly_fields = [field.name for field in AuditEvent._meta.fields]


@admin.register(CareNotification)
class CareNotificationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "title", "recipient", "severity", "state", "escalation_level")
    list_filter = ("kind", "severity", "state")


admin.site.register(NotificationPreference)
admin.site.register(EscalationPolicy)
admin.site.register(EscalationStep)
admin.site.register(PushSubscription)
admin.site.register(NotificationDelivery)
admin.site.register(WorkerHeartbeat)
