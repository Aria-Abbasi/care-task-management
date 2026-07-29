from datetime import datetime

from django.db.models import Q
from django.utils import timezone

from apps.common.timezones import patient_timezone

from .models import DoseLog, Medication, MedicationSchedule


def generate_dose_logs_for_date(target_date, patient=None):
    schedules = MedicationSchedule.objects.select_related("medication", "medication__patient", "medication__patient__organization").filter(
        medication__active=True,
        medication__approval_status=Medication.ApprovalStatus.APPROVED,
    )
    schedules = schedules.filter(
        Q(medication__starts_on__isnull=True) | Q(medication__starts_on__lte=target_date),
        Q(medication__ends_on__isnull=True) | Q(medication__ends_on__gte=target_date),
    )
    if patient is not None:
        schedules = schedules.filter(medication__patient=patient)
    created = 0
    for schedule in schedules:
        if schedule.days_of_week and target_date.isoweekday() not in schedule.days_of_week:
            continue
        scheduled_at = timezone.make_aware(datetime.combine(target_date, schedule.time), patient_timezone(schedule.medication.patient))
        _, was_created = DoseLog.objects.get_or_create(medication=schedule.medication, scheduled_at=scheduled_at)
        created += int(was_created)
    return created
