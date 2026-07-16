from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User


@admin.register(User)
class HavenUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (("Care access", {"fields": ("role", "phone")}),)
    add_fieldsets = UserAdmin.add_fieldsets + (("Care access", {"fields": ("email", "role", "phone")}),)
    list_display = ("username", "email", "first_name", "last_name", "role", "is_active")
    list_filter = UserAdmin.list_filter + ("role",)
