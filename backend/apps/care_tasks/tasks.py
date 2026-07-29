from celery import shared_task
from django.utils import timezone

from apps.common.timezones import patient_timezone
from apps.medications.services import generate_dose_logs_for_date
from apps.patients.models import Patient

from .services import generate_occurrences_for_date, mark_overdue_occurrences


@shared_task
def maintain_task_occurrences():
    created = 0
    doses_created = 0
    for patient in Patient.objects.filter(active=True).select_related("organization").iterator():
        local_date = timezone.localdate(timezone=patient_timezone(patient))
        created += generate_occurrences_for_date(local_date, patient=patient)
        doses_created += generate_dose_logs_for_date(local_date, patient=patient)
    return {
        "created": created,
        "marked_overdue": mark_overdue_occurrences(),
        "doses_created": doses_created,
    }
