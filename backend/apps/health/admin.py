from django.contrib import admin

from .models import VitalRecord


@admin.register(VitalRecord)
class VitalRecordAdmin(admin.ModelAdmin):
    list_display = ("patient", "type", "value", "secondary_value", "unit", "recorded_at", "recorded_by")
    list_filter = ("type",)
    date_hierarchy = "recorded_at"
