from django.contrib import admin

from .models import ShiftReport


@admin.register(ShiftReport)
class ShiftReportAdmin(admin.ModelAdmin):
    list_display = ("patient", "author", "recipient", "shift_started_at", "shift_ended_at", "status")
    list_filter = ("status",)
