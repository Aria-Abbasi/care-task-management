from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel
from apps.patients.models import Patient


class Task(TimeStampedModel):
    class Category(models.TextChoices):
        MEDICATION = "MEDICATION", "Medication"
        HEALTH = "HEALTH", "Health check"
        MEAL = "MEAL", "Meal"
        ACTIVITY = "ACTIVITY", "Activity"
        PERSONAL_CARE = "PERSONAL_CARE", "Personal care"
        OTHER = "OTHER", "Other"

    class Priority(models.TextChoices):
        LOW = "LOW", "Low"
        NORMAL = "NORMAL", "Normal"
        HIGH = "HIGH", "High"
        URGENT = "URGENT", "Urgent"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=200)
    category = models.CharField(max_length=24, choices=Category.choices)
    priority = models.CharField(max_length=12, choices=Priority.choices, default=Priority.NORMAL)
    instructions = models.TextField(blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_tasks"
    )
    client_reference = models.UUIDField(null=True, blank=True, unique=True, help_text="Idempotency key for offline creation")
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.patient}: {self.title}"


class TaskSchedule(TimeStampedModel):
    class Frequency(models.TextChoices):
        ONCE = "ONCE", "Once"
        DAILY = "DAILY", "Daily"
        WEEKLY = "WEEKLY", "Weekly"
        INTERVAL = "INTERVAL", "Interval"
        AFTER_EVENT = "AFTER_EVENT", "After event"

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="schedules")
    frequency = models.CharField(max_length=16, choices=Frequency.choices, default=Frequency.DAILY)
    time = models.TimeField(null=True, blank=True)
    specific_date = models.DateField(null=True, blank=True)
    interval_hours = models.PositiveSmallIntegerField(null=True, blank=True)
    days_of_week = models.JSONField(default=list, blank=True, help_text="ISO weekday numbers, Monday=1")
    event_reference = models.CharField(max_length=120, blank=True)
    window_before_minutes = models.PositiveSmallIntegerField(default=0)
    window_after_minutes = models.PositiveSmallIntegerField(default=30)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)

    def __str__(self):
        return f"{self.task.title} · {self.get_frequency_display()}"


class TaskOccurrence(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        DONE = "DONE", "Done"
        MISSED = "MISSED", "Missed"
        SKIPPED = "SKIPPED", "Skipped"
        DELAYED = "DELAYED", "Delayed"

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="occurrences")
    schedule = models.ForeignKey(TaskSchedule, on_delete=models.SET_NULL, null=True, blank=True, related_name="occurrences")
    scheduled_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="completed_task_occurrences"
    )
    delayed_until = models.DateTimeField(null=True, blank=True)
    outcome = models.CharField(max_length=16, blank=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["scheduled_at"]
        constraints = [models.UniqueConstraint(fields=["task", "scheduled_at"], name="unique_task_scheduled_occurrence")]

    def __str__(self):
        return f"{self.task.title} at {self.scheduled_at}"


class CompletionLog(TimeStampedModel):
    class Outcome(models.TextChoices):
        COMPLETED = "COMPLETED", "Completed"
        PARTIAL = "PARTIAL", "Partially completed"
        UNABLE = "UNABLE", "Unable to complete"
        REFUSED = "REFUSED", "Patient refused"

    occurrence = models.OneToOneField(TaskOccurrence, on_delete=models.CASCADE, related_name="completion")
    completed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="task_completion_logs")
    outcome = models.CharField(max_length=16, choices=Outcome.choices, default=Outcome.COMPLETED)
    note = models.TextField(blank=True)
    photo = models.ImageField(upload_to="task-completions/", blank=True)
    client_reference = models.UUIDField(null=True, blank=True, unique=True, help_text="Idempotency key for offline sync")

    def __str__(self):
        return f"Completion of {self.occurrence}"


class CompletionCorrection(TimeStampedModel):
    occurrence = models.ForeignKey(TaskOccurrence, on_delete=models.CASCADE, related_name="corrections")
    previous_status = models.CharField(max_length=12, choices=TaskOccurrence.Status.choices)
    corrected_status = models.CharField(max_length=12, choices=TaskOccurrence.Status.choices)
    previous_outcome = models.CharField(max_length=16, blank=True)
    corrected_outcome = models.CharField(max_length=16, blank=True)
    reason = models.CharField(max_length=255)
    note = models.TextField(blank=True)
    corrected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="task_completion_corrections")
    client_reference = models.UUIDField(null=True, blank=True, unique=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Correction for {self.occurrence} by {self.corrected_by}"
