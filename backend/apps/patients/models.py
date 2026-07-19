from django.conf import settings
from django.db import models

from apps.accounts.models import Organization
from apps.common.models import TimeStampedModel


class Patient(TimeStampedModel):
    class Gender(models.TextChoices):
        FEMALE = "FEMALE", "Female"
        MALE = "MALE", "Male"
        OTHER = "OTHER", "Other"
        UNDISCLOSED = "UNDISCLOSED", "Prefer not to say"

    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)
    birth_date = models.DateField()
    gender = models.CharField(max_length=16, choices=Gender.choices, default=Gender.UNDISCLOSED)
    room = models.CharField(max_length=64, blank=True)
    medical_notes = models.TextField(blank=True)
    photo = models.ImageField(upload_to="patients/", blank=True)
    active = models.BooleanField(default=True)
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, null=True, blank=True, related_name="patients")

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    def __str__(self):
        return self.full_name


class CareAssignment(TimeStampedModel):
    class Relationship(models.TextChoices):
        PRIMARY_CAREGIVER = "PRIMARY_CAREGIVER", "Primary caregiver"
        CAREGIVER = "CAREGIVER", "Caregiver"
        DOCTOR = "DOCTOR", "Doctor"
        FAMILY = "FAMILY", "Family"
        ADMINISTRATOR = "ADMINISTRATOR", "Administrator"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="care_assignments")
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="care_assignments")
    relationship = models.CharField(max_length=24, choices=Relationship.choices)
    active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "patient"], name="unique_user_patient_assignment")]

    def __str__(self):
        return f"{self.user} → {self.patient}"
