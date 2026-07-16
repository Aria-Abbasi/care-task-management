from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "ADMIN", "Administrator"
        CAREGIVER = "CAREGIVER", "Caregiver"
        DOCTOR = "DOCTOR", "Doctor"
        FAMILY = "FAMILY", "Family member"

    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=32, unique=True, null=True, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.CAREGIVER)

    @property
    def display_name(self):
        return self.get_full_name() or self.username

    def __str__(self):
        return f"{self.display_name} ({self.get_role_display()})"
