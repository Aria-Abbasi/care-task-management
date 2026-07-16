from django.contrib import admin

from .models import DoseLog, Medication, MedicationSchedule


class MedicationScheduleInline(admin.TabularInline):
    model = MedicationSchedule
    extra = 0


@admin.register(Medication)
class MedicationAdmin(admin.ModelAdmin):
    list_display = ("name", "patient", "dose", "unit", "stock_quantity", "active")
    inlines = [MedicationScheduleInline]


admin.site.register(DoseLog)
