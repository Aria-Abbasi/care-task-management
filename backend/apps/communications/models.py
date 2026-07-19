from django.conf import settings
from django.db import models

from apps.clinical.models import validate_clinical_file
from apps.common.models import TimeStampedModel
from apps.patients.models import Patient


class Conversation(TimeStampedModel):
    class Kind(models.TextChoices):
        CLINICAL = "CLINICAL", "Clinical"
        FAMILY = "FAMILY", "Family"
        HANDOVER = "HANDOVER", "Handover"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="conversations")
    title = models.CharField(max_length=200)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    participants = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="care_conversations")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_conversations")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-updated_at"]


class Message(TimeStampedModel):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="care_messages")
    body = models.TextField(blank=True)
    clinical = models.BooleanField(default=False)
    urgent = models.BooleanField(default=False)
    attachment = models.FileField(upload_to="message-attachments/", validators=[validate_clinical_file], blank=True)
    voice_note = models.FileField(upload_to="message-voice/", validators=[validate_clinical_file], blank=True)
    mentions = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="mentioned_messages")
    client_reference = models.UUIDField(null=True, blank=True, unique=True)
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]


class MessageReadReceipt(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="read_receipts")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="message_read_receipts")
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["message", "user"], name="unique_message_read_receipt")]


class ShiftAssignment(TimeStampedModel):
    class Status(models.TextChoices):
        SCHEDULED = "SCHEDULED", "Scheduled"
        ACCEPTED = "ACCEPTED", "Accepted"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"
        CANCELED = "CANCELED", "Canceled"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="shift_assignments")
    caregiver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shift_assignments")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SCHEDULED)
    notes = models.TextField(blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["starts_at"]


class CaregiverAvailability(TimeStampedModel):
    caregiver = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="availability_windows")
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    available = models.BooleanField(default=True)
    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["starts_at"]
        constraints = [models.UniqueConstraint(fields=["caregiver", "starts_at", "ends_at"], name="unique_caregiver_availability_window")]
