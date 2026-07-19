from django.contrib import admin

from .models import (
    DoseCorrection,
    DoseLog,
    Medication,
    MedicationInteraction,
    MedicationSchedule,
    RefillRequest,
    StockAdjustment,
)


class MedicationScheduleInline(admin.TabularInline):
    model = MedicationSchedule
    extra = 0


@admin.register(Medication)
class MedicationAdmin(admin.ModelAdmin):
    list_display = ("name", "patient", "dose", "unit", "stock_quantity", "active")
    inlines = [MedicationScheduleInline]


admin.site.register(DoseLog)
admin.site.register(DoseCorrection)
admin.site.register(MedicationInteraction)
admin.site.register(RefillRequest)
admin.site.register(StockAdjustment)
