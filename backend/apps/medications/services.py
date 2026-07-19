from datetime import datetime

from django.utils import timezone

from .models import DoseLog, MedicationSchedule


def generate_dose_logs_for_date(target_date, patient=None):
    schedules = MedicationSchedule.objects.select_related("medication").filter(medication__active=True)
    if patient is not None:
        schedules = schedules.filter(medication__patient=patient)
    created = 0
    for schedule in schedules:
        if schedule.days_of_week and target_date.isoweekday() not in schedule.days_of_week:
            continue
        scheduled_at = timezone.make_aware(datetime.combine(target_date, schedule.time), timezone.get_current_timezone())
        _, was_created = DoseLog.objects.get_or_create(medication=schedule.medication, scheduled_at=scheduled_at)
        created += int(was_created)
    return created
