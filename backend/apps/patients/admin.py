from django.contrib import admin

from .models import CareAssignment, Patient


@admin.register(Patient)
class PatientAdmin(admin.ModelAdmin):
    list_display = ("full_name", "birth_date", "room", "active")
    search_fields = ("first_name", "last_name", "room")
    list_filter = ("active", "gender")


@admin.register(CareAssignment)
class CareAssignmentAdmin(admin.ModelAdmin):
    list_display = ("user", "patient", "relationship", "active")
    list_filter = ("relationship", "active")
