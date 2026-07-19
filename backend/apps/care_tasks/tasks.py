from celery import shared_task
from django.utils import timezone

from apps.medications.services import generate_dose_logs_for_date

from .services import generate_occurrences_for_date, mark_overdue_occurrences


@shared_task
def maintain_task_occurrences():
    local_date = timezone.localdate()
    return {
        "created": generate_occurrences_for_date(local_date),
        "marked_overdue": mark_overdue_occurrences(),
        "doses_created": generate_dose_logs_for_date(local_date),
    }
