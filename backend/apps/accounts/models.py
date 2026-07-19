import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone

from apps.common.models import TimeStampedModel


class Organization(TimeStampedModel):
    name = models.CharField(max_length=160)
    slug = models.SlugField(unique=True)
    country_code = models.CharField(max_length=2, blank=True)
    timezone = models.CharField(max_length=64, default="UTC")
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "ADMIN", "Administrator"
        CAREGIVER = "CAREGIVER", "Caregiver"
        DOCTOR = "DOCTOR", "Doctor"
        FAMILY = "FAMILY", "Family member"

    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=32, unique=True, null=True, blank=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.CAREGIVER)
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, null=True, blank=True, related_name="users")
    mfa_secret = models.CharField(max_length=64, blank=True)
    mfa_enabled = models.BooleanField(default=False)
    mfa_confirmed_at = models.DateTimeField(null=True, blank=True)

    @property
    def display_name(self):
        return self.get_full_name() or self.username

    def __str__(self):
        return f"{self.display_name} ({self.get_role_display()})"


class SessionToken(TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="session_tokens")
    key_prefix = models.CharField(max_length=12, db_index=True)
    key_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField(db_index=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    rotated_from = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="rotations")
    device_name = models.CharField(max_length=160, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    ip_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-created_at"]

    @staticmethod
    def digest(raw_token):
        return hashlib.sha256(raw_token.encode()).hexdigest()

    @classmethod
    def issue(cls, *, user, request=None, rotated_from=None, lifetime=None):
        raw = secrets.token_urlsafe(40)
        lifetime = lifetime or timedelta(hours=12)
        user_agent = request.META.get("HTTP_USER_AGENT", "")[:500] if request else ""
        device_name = request.data.get("device_name", "")[:160] if request and hasattr(request, "data") else ""
        ip = request.META.get("REMOTE_ADDR", "") if request else ""
        ip_hash = hashlib.sha256(f"{settings.SECRET_KEY}:{ip}".encode()).hexdigest() if ip else ""
        session = cls.objects.create(
            user=user,
            key_prefix=raw[:12],
            key_hash=cls.digest(raw),
            expires_at=timezone.now() + lifetime,
            rotated_from=rotated_from,
            device_name=device_name,
            user_agent=user_agent,
            ip_hash=ip_hash,
        )
        return raw, session

    @property
    def active(self):
        return self.revoked_at is None and self.expires_at > timezone.now()

    def revoke(self):
        if self.revoked_at is None:
            self.revoked_at = timezone.now()
            self.save(update_fields=["revoked_at", "updated_at"])


class LoginAttempt(models.Model):
    identifier_hash = models.CharField(max_length=64, db_index=True)
    ip_hash = models.CharField(max_length=64, db_index=True)
    succeeded = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
