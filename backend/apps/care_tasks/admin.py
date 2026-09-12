from django.contrib import admin

from .models import AdHocTemplate, CareTaskTemplate, CompletionCorrection, CompletionLog, Task, TaskOccurrence, TaskSchedule


class TaskScheduleInline(admin.TabularInline):
    model = TaskSchedule
    extra = 0


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("title", "patient", "category", "priority", "assigned_to", "active")
    list_filter = ("category", "priority", "active")
    search_fields = ("title", "patient__first_name", "patient__last_name")
    inlines = [TaskScheduleInline]


admin.site.register(TaskOccurrence)
admin.site.register(CompletionLog)
admin.site.register(CompletionCorrection)
admin.site.register(CareTaskTemplate)
admin.site.register(AdHocTemplate)
