from django.conf import settings
from django.db import models

from apps.accounts.models import Organization
from apps.common.models import TimeStampedModel
from apps.patients.models import Patient


class Medication(TimeStampedModel):
    class ApprovalStatus(models.TextChoices):
        PENDING = "PENDING", "Pending clinical approval"
        APPROVED = "APPROVED", "Approved"
        REJECTED = "REJECTED", "Rejected"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="medications")
    name = models.CharField(max_length=160)
    dose = models.DecimalField(max_digits=10, decimal_places=2)
    unit = models.CharField(max_length=32)
    route = models.CharField(max_length=64, default="Oral")
    instructions = models.TextField(blank=True)
    photo = models.ImageField(upload_to="medications/", blank=True)
    stock_quantity = models.PositiveIntegerField(null=True, blank=True)
    active = models.BooleanField(default=True)
    medication_code = models.CharField(max_length=64, blank=True, db_index=True)
    code_system = models.CharField(max_length=160, blank=True)
    barcode = models.CharField(max_length=128, blank=True, db_index=True)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    is_prn = models.BooleanField(default=False, help_text="Administer only as needed")
    prn_reason = models.CharField(max_length=255, blank=True)
    max_daily_doses = models.PositiveSmallIntegerField(null=True, blank=True)
    timing_window_minutes = models.PositiveSmallIntegerField(
        default=30,
        help_text="Allowed minutes before or after the scheduled time before a timing exception is recorded.",
    )
    timing_escalation_level = models.PositiveSmallIntegerField(
        default=1,
        help_text="Highest organization escalation level used when this order is administered outside its timing window.",
    )
    timing_escalation_policy = models.ForeignKey(
        "safety.EscalationPolicy",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="timing_escalation_medications",
        help_text="Optional organization escalation chain for timing exceptions; the organization default is used when empty.",
    )
    approval_status = models.CharField(max_length=16, choices=ApprovalStatus.choices, default=ApprovalStatus.APPROVED)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_medications"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    prescriber = models.CharField(max_length=160, blank=True)

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
    version = models.PositiveIntegerField(default=1)
    verified_patient = models.BooleanField(default=False)
    verified_medication = models.BooleanField(default=False)
    verified_dose = models.BooleanField(default=False)
    verified_route = models.BooleanField(default=False)
    verified_time = models.BooleanField(default=False)
    was_late = models.BooleanField(default=False)
    late_minutes = models.PositiveIntegerField(default=0)

    class TimingStatus(models.TextChoices):
        ON_TIME = "ON_TIME", "On time"
        EARLY = "EARLY", "Administered early"
        LATE = "LATE", "Administered late"

    timing_status = models.CharField(max_length=12, choices=TimingStatus.choices, default=TimingStatus.ON_TIME)
    timing_variance_minutes = models.IntegerField(default=0)
    timing_window_minutes = models.PositiveSmallIntegerField(default=30)
    timing_reason = models.TextField(blank=True)
    is_prn = models.BooleanField(default=False)

    class Meta:
        ordering = ["scheduled_at"]
        constraints = [models.UniqueConstraint(fields=["medication", "scheduled_at"], name="unique_medication_scheduled_dose")]


class DoseCorrection(TimeStampedModel):
    dose_log = models.ForeignKey(DoseLog, on_delete=models.CASCADE, related_name="corrections")
    previous_status = models.CharField(max_length=12, choices=DoseLog.Status.choices)
    corrected_status = models.CharField(max_length=12, choices=DoseLog.Status.choices)
    reason = models.CharField(max_length=255)
    note = models.TextField(blank=True)
    corrected_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="dose_corrections")
    client_reference = models.UUIDField(null=True, blank=True, unique=True)

    class Meta:
        ordering = ["created_at"]


class MedicationInteraction(TimeStampedModel):
    class Severity(models.TextChoices):
        INFO = "INFO", "Information"
        WARNING = "WARNING", "Warning"
        SEVERE = "SEVERE", "Severe"

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, null=True, blank=True, related_name="medication_interactions")
    medication_a = models.CharField(max_length=160)
    medication_b = models.CharField(max_length=160)
    severity = models.CharField(max_length=12, choices=Severity.choices)
    message = models.TextField()
    source = models.CharField(max_length=255)
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "medication_a", "medication_b"], name="unique_medication_interaction")
        ]


class RefillRequest(TimeStampedModel):
    class Status(models.TextChoices):
        REQUESTED = "REQUESTED", "Requested"
        ORDERED = "ORDERED", "Ordered"
        RECEIVED = "RECEIVED", "Received"
        CANCELED = "CANCELED", "Canceled"

    medication = models.ForeignKey(Medication, on_delete=models.CASCADE, related_name="refill_requests")
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="refill_requests")
    quantity = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.REQUESTED)
    note = models.TextField(blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="resolved_refills"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)


class StockAdjustment(TimeStampedModel):
    medication = models.ForeignKey(Medication, on_delete=models.CASCADE, related_name="stock_adjustments")
    quantity_delta = models.IntegerField()
    reason = models.CharField(max_length=255)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    resulting_quantity = models.PositiveIntegerField()

    class Meta:
        ordering = ["-created_at"]
