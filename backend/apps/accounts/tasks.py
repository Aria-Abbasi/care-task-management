from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import LoginAttempt, SessionToken


@shared_task
def purge_expired_security_records():
    now = timezone.now()
    attempts, _ = LoginAttempt.objects.filter(created_at__lt=now - timedelta(days=30)).delete()
    sessions, _ = SessionToken.objects.filter(expires_at__lt=now - timedelta(days=30)).delete()
    return {"login_attempts": attempts, "sessions": sessions}
