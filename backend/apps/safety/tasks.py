from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from .models import NotificationDelivery, WorkerHeartbeat
from .providers import deliver
from .services import scan_overdue_alerts


def heartbeat(name, metadata=None):
    WorkerHeartbeat.objects.update_or_create(name=name, defaults={"last_seen_at": timezone.now(), "metadata": metadata or {}})


@shared_task
def scan_overdue_care():
    result = scan_overdue_alerts()
    heartbeat("overdue-scanner", result)
    return result


@shared_task
def dispatch_pending_notifications(limit=100):
    now = timezone.now()
    deliveries = NotificationDelivery.objects.filter(
        status__in=[NotificationDelivery.Status.PENDING, NotificationDelivery.Status.FAILED],
        next_attempt_at__lte=now,
    ).select_related("notification", "notification__recipient")[:limit]
    stats = {"accepted": 0, "failed": 0, "dead": 0}
    for delivery in deliveries:
        delivery.attempts += 1
        try:
            delivery.provider_id = deliver(delivery)
            delivery.status = NotificationDelivery.Status.ACCEPTED
            delivery.accepted_at = now
            delivery.error = ""
            stats["accepted"] += 1
        except Exception as exc:  # provider failures must be persisted for retry/dead-letter review
            delivery.error = str(exc)[:2000]
            if delivery.attempts >= 3:
                delivery.status = NotificationDelivery.Status.DEAD
                stats["dead"] += 1
            else:
                delivery.status = NotificationDelivery.Status.FAILED
                delivery.next_attempt_at = now + timedelta(minutes=2**delivery.attempts)
                stats["failed"] += 1
        delivery.save(update_fields=["attempts", "provider_id", "status", "accepted_at", "error", "next_attempt_at", "updated_at"])
    heartbeat("notification-dispatcher", stats)
    return stats
