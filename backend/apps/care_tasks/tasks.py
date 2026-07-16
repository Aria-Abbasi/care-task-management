from celery import shared_task
from django.utils import timezone

from .services import generate_occurrences_for_date, mark_overdue_occurrences


@shared_task
def maintain_task_occurrences():
    local_date = timezone.localdate()
    return {
        "created": generate_occurrences_for_date(local_date),
        "marked_overdue": mark_overdue_occurrences(),
    }
