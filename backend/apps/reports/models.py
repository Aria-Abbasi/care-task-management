from django.conf import settings
from django.db import models

from apps.common.models import TimeStampedModel
from apps.patients.models import Patient


class ShiftReport(TimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        SENT = "SENT", "Sent"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="shift_reports")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="authored_shift_reports")
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="received_shift_reports"
    )
    shift_started_at = models.DateTimeField()
    shift_ended_at = models.DateTimeField()
    observations = models.TextField(blank=True)
    concerns = models.TextField(blank=True)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.DRAFT)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-shift_ended_at"]

    def __str__(self):
        return f"{self.patient} handover by {self.author}"
