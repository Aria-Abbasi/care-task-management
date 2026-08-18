from datetime import datetime, time, timedelta

from django.utils import timezone

from apps.common.timezones import patient_timezone

from .models import Task, TaskOccurrence, TaskSchedule


def generate_occurrences_for_date(target_date, patient=None):
    """Idempotently generate calendar-based occurrences for one local date."""
    created = 0
    schedules = TaskSchedule.objects.select_related("task", "task__patient", "task__patient__organization").filter(
        task__active=True, task__schedule_type=Task.ScheduleType.SCHEDULED
    )
    if patient is not None:
        schedules = schedules.filter(task__patient=patient)
    for schedule in schedules:
        if schedule.starts_on and target_date < schedule.starts_on:
            continue
        if schedule.ends_on and target_date > schedule.ends_on:
            continue
        if schedule.frequency == TaskSchedule.Frequency.ONCE and schedule.specific_date != target_date:
            continue
        if schedule.frequency == TaskSchedule.Frequency.WEEKLY and target_date.isoweekday() not in schedule.days_of_week:
            continue
        scheduled_times = [schedule.time or time.min]
        if schedule.frequency == TaskSchedule.Frequency.INTERVAL:
            first = datetime.combine(target_date, schedule.time or time.min)
            day_end = datetime.combine(target_date + timedelta(days=1), time.min)
            interval = timedelta(hours=schedule.interval_hours or 24)
            scheduled_times = []
            cursor = first
            while cursor < day_end:
                scheduled_times.append(cursor.time())
                cursor += interval
        for scheduled_time in scheduled_times:
            scheduled_at = timezone.make_aware(datetime.combine(target_date, scheduled_time), patient_timezone(schedule.task.patient))
            _, was_created = TaskOccurrence.objects.get_or_create(
                task=schedule.task,
                scheduled_at=scheduled_at,
                defaults={"schedule": schedule},
            )
            created += int(was_created)
    return created


def mark_overdue_occurrences(grace_minutes=30):
    now = timezone.now()
    overdue_ids = []
    candidates = (
        TaskOccurrence.objects.filter(status=TaskOccurrence.Status.PENDING, scheduled_at__lt=now)
        .select_related("schedule")
        .only("id", "scheduled_at", "schedule__window_after_minutes")
    )
    for occurrence in candidates.iterator(chunk_size=1000):
        allowed_minutes = occurrence.schedule.window_after_minutes if occurrence.schedule else grace_minutes
        if occurrence.scheduled_at + timedelta(minutes=allowed_minutes) < now:
            overdue_ids.append(occurrence.id)
    if not overdue_ids:
        return 0
    return TaskOccurrence.objects.filter(id__in=overdue_ids).update(status=TaskOccurrence.Status.MISSED)
