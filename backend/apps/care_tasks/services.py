from datetime import datetime, time, timedelta

from django.utils import timezone

from .models import TaskOccurrence, TaskSchedule


def generate_occurrences_for_date(target_date):
    """Idempotently generate calendar-based occurrences for one local date."""
    created = 0
    schedules = TaskSchedule.objects.select_related("task").filter(task__active=True)
    for schedule in schedules:
        if schedule.starts_on and target_date < schedule.starts_on:
            continue
        if schedule.ends_on and target_date > schedule.ends_on:
            continue
        if schedule.frequency == TaskSchedule.Frequency.ONCE and schedule.specific_date != target_date:
            continue
        if schedule.frequency == TaskSchedule.Frequency.WEEKLY and target_date.isoweekday() not in schedule.days_of_week:
            continue
        if schedule.frequency in {TaskSchedule.Frequency.INTERVAL, TaskSchedule.Frequency.AFTER_EVENT}:
            continue
        scheduled_time = schedule.time or time.min
        scheduled_at = timezone.make_aware(datetime.combine(target_date, scheduled_time), timezone.get_current_timezone())
        _, was_created = TaskOccurrence.objects.get_or_create(
            task=schedule.task,
            scheduled_at=scheduled_at,
            defaults={"schedule": schedule},
        )
        created += int(was_created)
    return created


def mark_overdue_occurrences(grace_minutes=30):
    cutoff = timezone.now() - timedelta(minutes=grace_minutes)
    return TaskOccurrence.objects.filter(status=TaskOccurrence.Status.PENDING, scheduled_at__lt=cutoff).update(
        status=TaskOccurrence.Status.MISSED
    )
