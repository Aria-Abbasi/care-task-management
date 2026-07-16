from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel
from apps.patients.models import Patient


class Medication(TimeStampedModel):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="medications")
    name = models.CharField(max_length=160)
    dose = models.DecimalField(max_digits=10, decimal_places=2)
    unit = models.CharField(max_length=32)
    route = models.CharField(max_length=64, default="Oral")
    instructions = models.TextField(blank=True)
    photo = models.ImageField(upload_to="medications/", blank=True)
    stock_quantity = models.PositiveIntegerField(null=True, blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.name} {self.dose:g} {self.unit}"


class MedicationSchedule(TimeStampedModel):
    medication = models.ForeignKey(Medication, on_delete=models.CASCADE, related_name="schedules")
    time = models.TimeField()
    days_of_week = models.JSONField(default=list, blank=True)
    instructions = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["time"]


class DoseLog(TimeStampedModel):
    class Status(models.TextChoices):
        SCHEDULED = "SCHEDULED", "Scheduled"
        GIVEN = "GIVEN", "Given"
        MISSED = "MISSED", "Missed"
        REFUSED = "REFUSED", "Refused"
        HELD = "HELD", "Held"

    medication = models.ForeignKey(Medication, on_delete=models.CASCADE, related_name="dose_logs")
    scheduled_at = models.DateTimeField(db_index=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.SCHEDULED)
    administered_at = models.DateTimeField(null=True, blank=True)
    administered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="administered_doses"
    )
    note = models.TextField(blank=True)
    client_reference = models.UUIDField(null=True, blank=True, unique=True)

    class Meta:
        ordering = ["scheduled_at"]
        constraints = [models.UniqueConstraint(fields=["medication", "scheduled_at"], name="unique_medication_scheduled_dose")]
