import uuid

from django.conf import settings
from django.db import models

from apps.accounts.models import Organization
from apps.common.models import TimeStampedModel
from apps.patients.models import Patient


class AuditEvent(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_events")
    patient = models.ForeignKey(Patient, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_events")
    action = models.CharField(max_length=64, db_index=True)
    entity_type = models.CharField(max_length=64, db_index=True)
    entity_id = models.CharField(max_length=64, blank=True)
    summary = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)
    client_reference = models.UUIDField(null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValueError("Audit events are append-only.")
        return super().save(*args, **kwargs)


class CareNotification(TimeStampedModel):
    class Kind(models.TextChoices):
        TASK_OVERDUE = "TASK_OVERDUE", "Task overdue"
        DOSE_OVERDUE = "DOSE_OVERDUE", "Medication overdue"
        DOSE_TIMING_EXCEPTION = "DOSE_TIMING_EXCEPTION", "Medication timing exception"
        SYNC_CONFLICT = "SYNC_CONFLICT", "Sync conflict"
        VITAL_ALERT = "VITAL_ALERT", "Vital threshold alert"
        URGENT_MESSAGE = "URGENT_MESSAGE", "Urgent message"

    class Severity(models.TextChoices):
        INFO = "INFO", "Information"
        WARNING = "WARNING", "Warning"
        CRITICAL = "CRITICAL", "Critical"

    class State(models.TextChoices):
        UNREAD = "UNREAD", "Unread"
        READ = "READ", "Read"
        ACKNOWLEDGED = "ACKNOWLEDGED", "Acknowledged"
        SNOOZED = "SNOOZED", "Snoozed"

    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="care_notifications")
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    severity = models.CharField(max_length=12, choices=Severity.choices, default=Severity.WARNING)
    state = models.CharField(max_length=16, choices=State.choices, default=State.UNREAD, db_index=True)
    title = models.CharField(max_length=160)
    message = models.TextField()
    source_type = models.CharField(max_length=32)
    source_id = models.CharField(max_length=64)
    escalation_level = models.PositiveSmallIntegerField(default=1)
    due_at = models.DateTimeField()
    read_at = models.DateTimeField(null=True, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    snoozed_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["recipient", "kind", "source_type", "source_id"], name="unique_recipient_care_alert")
        ]


class NotificationPreference(TimeStampedModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_preference")
    push_enabled = models.BooleanField(default=True)
    sms_enabled = models.BooleanField(default=False)
    voice_enabled = models.BooleanField(default=False)
    quiet_hours_start = models.TimeField(null=True, blank=True)
    quiet_hours_end = models.TimeField(null=True, blank=True)
    critical_override = models.BooleanField(default=True)
    timezone = models.CharField(max_length=64, default="UTC")


class EscalationPolicy(TimeStampedModel):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="escalation_policies")
    name = models.CharField(max_length=160)
    active = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]


class EscalationStep(TimeStampedModel):
    class Channel(models.TextChoices):
        IN_APP = "IN_APP", "In-app"
        PUSH = "PUSH", "Web push"
        SMS = "SMS", "SMS"
        VOICE = "VOICE", "Voice call"

    policy = models.ForeignKey(EscalationPolicy, on_delete=models.CASCADE, related_name="steps")
    level = models.PositiveSmallIntegerField()
    delay_minutes = models.PositiveSmallIntegerField(default=0)
    channel = models.CharField(max_length=12, choices=Channel.choices)
    recipient_roles = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["level", "delay_minutes", "channel"]
        constraints = [models.UniqueConstraint(fields=["policy", "level", "channel"], name="unique_escalation_policy_step")]


class PushSubscription(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.URLField(max_length=1000, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    user_agent = models.CharField(max_length=500, blank=True)
    device_name = models.CharField(max_length=160, blank=True)
    active = models.BooleanField(default=True)
    failure_count = models.PositiveSmallIntegerField(default=0)
    last_delivered_at = models.DateTimeField(null=True, blank=True)


class NotificationDelivery(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted by provider"
        DELIVERED = "DELIVERED", "Delivered"
        FAILED = "FAILED", "Failed"
        DEAD = "DEAD", "Dead letter"
        SUPPRESSED = "SUPPRESSED", "Suppressed by quiet hours or preference"

    notification = models.ForeignKey(CareNotification, on_delete=models.CASCADE, related_name="deliveries")
    channel = models.CharField(max_length=12, choices=EscalationStep.Channel.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    destination_hint = models.CharField(max_length=255, blank=True)
    provider_id = models.CharField(max_length=255, blank=True, db_index=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.TextField(blank=True)
    next_attempt_at = models.DateTimeField(null=True, blank=True, db_index=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    receipt_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["notification", "channel"], name="unique_notification_delivery_channel")]


class WorkerHeartbeat(models.Model):
    name = models.CharField(max_length=100, unique=True)
    last_seen_at = models.DateTimeField()
    metadata = models.JSONField(default=dict, blank=True)
