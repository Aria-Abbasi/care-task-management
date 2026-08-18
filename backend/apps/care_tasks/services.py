from datetime import datetime, time, timedelta

from django.utils import timezone

from apps.common.timezones import patient_timezone

from .models import CompletionLog, Task, TaskOccurrence, TaskSchedule


def get_care_time_window(hour: int) -> str:
    """Bucket local hour into one of 4 care windows."""
    if 6 <= hour < 12:
        return "MORNING"
    elif 12 <= hour < 18:
        return "AFTERNOON"
    elif 18 <= hour < 23:
        return "EVENING"
    else:
        return "NIGHT"


def infer_action_icon(title: str, category: str) -> str:
    """Infer the most representative icon name for a care action."""
    title_lower = title.lower()
    if any(k in title_lower for k in ["water", "hydrat", "fluid", "drink", "آب", "مایعات", "نوشید"]):
        return "droplets"
    if any(k in title_lower for k in ["turn", "reposition", "posture", "mobility", "walk", "حرکت", "وضعیت", "جابجا", "چرخش", "راه رفتن", "پهلوی"]):
        return "heart-pulse"
    if any(k in title_lower for k in ["hygiene", "wash", "bath", "clean", "mouth", "teeth", "شستشو", "نظافت", "حمام", "بهداشت", "مسواک", "صورت"]):
        return "sparkles"
    if any(k in title_lower for k in ["toilet", "bathroom", "restroom", "wc", "سرویس", "دستشویی", "توالت"]):
        return "user-round"
    if any(k in title_lower for k in ["med", "pill", "drug", "دارو", "قرص"]):
        return "pill"
    if any(k in title_lower for k in ["meal", "food", "snack", "breakfast", "lunch", "dinner", "غذا", "میان‌وعده", "صبحانه", "ناهار", "شام"]):
        return "utensils"
    if category == Task.Category.PERSONAL_CARE:
        return "user-round"
    if category == Task.Category.HEALTH:
        return "heart-pulse"
    if category == Task.Category.MEDICATION:
        return "pill"
    if category == Task.Category.MEAL:
        return "utensils"
    return "zap"


WINDOW_DEFAULTS = {
    "MORNING": [
        {
            "id": None,
            "title": "آب‌رسانی صبحگاهی",
            "title_en": "Morning Hydration",
            "category": "PERSONAL_CARE",
            "icon": "droplets",
            "default_note": "نوشیدن ۲۰۰ میلی‌لیتر آب و مایعات",
            "default_note_en": "Assisted with 200ml hydration intake",
            "is_on_demand_task": False,
        },
        {
            "id": None,
            "title": "بهداشت و نظافت صبحگاهی",
            "title_en": "Morning Hygiene & Care",
            "category": "PERSONAL_CARE",
            "icon": "sparkles",
            "default_note": "شستشوی دست و صورت و بهداشت دهان",
            "default_note_en": "Completed morning oral and facial hygiene",
            "is_on_demand_task": False,
        },
        {
            "id": None,
            "title": "بررسی علائم و راحتی صبحگاهی",
            "title_en": "Morning Vital & Comfort Check",
            "category": "HEALTH",
            "icon": "heart-pulse",
            "default_note": "بیمار آرام و هوشیار، وضعیت پایدار",
            "default_note_en": "Patient comfortable, vitals checked",
            "is_on_demand_task": False,
        },
    ],
    "AFTERNOON": [
        {
            "id": None,
            "title": "آب‌رسانی میان‌روز",
            "title_en": "Afternoon Hydration",
            "category": "PERSONAL_CARE",
            "icon": "droplets",
            "default_note": "نوشیدن آب یا چای بعدازظهر",
            "default_note_en": "Fluid intake provided",
            "is_on_demand_task": False,
        },
        {
            "id": None,
            "title": "تغییر وضعیت و تحرک",
            "title_en": "Position Repositioning & Mobility",
            "category": "PERSONAL_CARE",
            "icon": "heart-pulse",
            "default_note": "کمک به جابه‌جایی و نشستن راحت",
            "default_note_en": "Assisted with repositioning and comfort",
            "is_on_demand_task": False,
        },
        {
            "id": None,
            "title": "کمک به سرویس بهداشتی",
            "title_en": "Restroom Assistance",
            "category": "PERSONAL_CARE",
            "icon": "user-round",
            "default_note": "همراهی ایمن و نظافت",
            "default_note_en": "Assisted safely to restroom",
            "is_on_demand_task": False,
        },
    ],
    "EVENING": [
        {
            "id": None,
            "title": "آب‌رسانی عصرگاهی",
            "title_en": "Evening Hydration",
            "category": "PERSONAL_CARE",
            "icon": "droplets",
            "default_note": "نوشیدن مایعات",
            "default_note_en": "Evening fluid intake logged",
            "is_on_demand_task": False,
        },
        {
            "id": None,
            "title": "آماده‌سازی برای استراحت",
            "title_en": "Evening Comfort & Wind-down",
            "category": "PERSONAL_CARE",
            "icon": "sparkles",
            "default_note": "تنظیم بالش، لباس راحت و آرامش بیمار",
            "default_note_en": "Assisted with evening wind-down and comfort",
            "is_on_demand_task": False,
        },
        {
            "id": None,
            "title": "کمک به سرویس بهداشتی شبانگاهی",
            "title_en": "Evening Restroom Assistance",
            "category": "PERSONAL_CARE",
            "icon": "user-round",
            "default_note": "همراهی به سرویس بهداشتی قبل از خواب",
            "default_note_en": "Pre-sleep restroom assistance",
            "is_on_demand_task": False,
        },
    ],
    "NIGHT": [
        {
            "id": None,
            "title": "تغییر وضعیت و چرخش در خواب",
            "title_en": "Sleep Position Change",
            "category": "PERSONAL_CARE",
            "icon": "heart-pulse",
            "default_note": "تغییر وضعیت به پهلو برای جلوگیری از فشار و زخم",
            "default_note_en": "Repositioned to reduce pressure points during sleep",
            "is_on_demand_task": False,
        },
        {
            "id": None,
            "title": "بررسی آرامش و راحتی شبانه",
            "title_en": "Night Comfort & Safety Check",
            "category": "HEALTH",
            "icon": "sparkles",
            "default_note": "تنفس منظم، خواب آرام و وضعیت پایدار",
            "default_note_en": "Patient sleeping peacefully, checked breathing",
            "is_on_demand_task": False,
        },
        {
            "id": None,
            "title": "کمک به سرویس بهداشتی شبانه",
            "title_en": "Night Restroom Assistance",
            "category": "PERSONAL_CARE",
            "icon": "user-round",
            "default_note": "همراهی ایمن در نیمه‌شب",
            "default_note_en": "Assisted safely at night",
            "is_on_demand_task": False,
        },
    ],
}


def get_suggested_quick_actions(patient, current_time=None, target_hour=None, days_lookback=30, max_suggestions=5):
    """
    Rank dynamic quick-action suggestions for a patient based on care window & historical logs.
    """
    tz = patient_timezone(patient)
    now_local = (current_time or timezone.now()).astimezone(tz)
    hour = target_hour if target_hour is not None else now_local.hour
    active_window = get_care_time_window(hour)
    since = (current_time or timezone.now()) - timedelta(days=days_lookback)

    # 1. Fetch completed occurrences for this patient in the lookback window
    completed_occurrences = (
        TaskOccurrence.objects.filter(
            task__patient=patient,
            status=TaskOccurrence.Status.DONE,
            completed_at__isnull=False,
            completed_at__gte=since,
        )
        .select_related("task", "completion")
        .order_by("-completed_at")
    )

    # 2. Query active ON_DEMAND tasks for this patient
    patient_on_demand_tasks = {
        task.title.strip().casefold(): task
        for task in Task.objects.filter(patient=patient, schedule_type=Task.ScheduleType.ON_DEMAND, active=True)
    }

    # 3. Aggregate historical frequency
    task_stats = {}
    for occ in completed_occurrences:
        task = occ.task
        title_key = task.title.strip().casefold()
        occ_local_time = occ.completed_at.astimezone(tz)
        occ_hour = occ_local_time.hour
        in_window = get_care_time_window(occ_hour) == active_window

        if title_key not in task_stats:
            default_note = (occ.completion.note if hasattr(occ, "completion") and occ.completion and occ.completion.note else task.instructions)
            task_stats[title_key] = {
                "id": task.id if task.schedule_type == Task.ScheduleType.ON_DEMAND else None,
                "title": task.title,
                "title_en": task.title,
                "category": task.category,
                "icon": infer_action_icon(task.title, task.category),
                "time_context_count": 0,
                "total_count": 0,
                "latest_completed_at": occ.completed_at,
                "default_note": default_note,
                "default_note_en": default_note,
                "is_on_demand_task": (task.schedule_type == Task.ScheduleType.ON_DEMAND),
            }
        stats = task_stats[title_key]
        stats["total_count"] += 1
        if in_window:
            stats["time_context_count"] += 1
        if occ.completed_at > stats["latest_completed_at"]:
            stats["latest_completed_at"] = occ.completed_at
            if hasattr(occ, "completion") and occ.completion and occ.completion.note:
                stats["default_note"] = occ.completion.note
                stats["default_note_en"] = occ.completion.note

    # Include any patient ON_DEMAND tasks that have no recent completions yet
    for title_key, on_demand_task in patient_on_demand_tasks.items():
        if title_key not in task_stats:
            task_stats[title_key] = {
                "id": on_demand_task.id,
                "title": on_demand_task.title,
                "title_en": on_demand_task.title,
                "category": on_demand_task.category,
                "icon": infer_action_icon(on_demand_task.title, on_demand_task.category),
                "time_context_count": 0,
                "total_count": 0,
                "latest_completed_at": on_demand_task.created_at,
                "default_note": on_demand_task.instructions or "",
                "default_note_en": on_demand_task.instructions or "",
                "is_on_demand_task": True,
            }

    # 4. Rank candidates: primary = time_context_count, secondary = total_count, tertiary = recency
    ranked_candidates = sorted(
        task_stats.values(),
        key=lambda item: (
            -item["time_context_count"],
            -item["total_count"],
            -(item["latest_completed_at"].timestamp() if item["latest_completed_at"] else 0),
        ),
    )

    # 5. Build final list, backfilling with window defaults if needed
    final_suggestions = []
    seen_titles = set()

    for candidate in ranked_candidates:
        title_norm = candidate["title"].strip().casefold()
        if title_norm not in seen_titles:
            seen_titles.add(title_norm)
            candidate_copy = dict(candidate)
            candidate_copy.pop("latest_completed_at", None)
            final_suggestions.append(candidate_copy)
            if len(final_suggestions) >= max_suggestions:
                break

    # Backfill with window defaults if < 3 suggestions
    defaults = WINDOW_DEFAULTS.get(active_window, WINDOW_DEFAULTS["MORNING"])
    for default_item in defaults:
        if len(final_suggestions) >= max_suggestions:
            break
        title_norm = default_item["title"].strip().casefold()
        title_en_norm = default_item["title_en"].strip().casefold()
        if title_norm not in seen_titles and title_en_norm not in seen_titles:
            seen_titles.add(title_norm)
            seen_titles.add(title_en_norm)
            item_copy = dict(default_item)
            item_copy["time_context_count"] = 0
            item_copy["total_count"] = 0
            final_suggestions.append(item_copy)

    return {
        "time_window": active_window,
        "hour": hour,
        "suggestions": final_suggestions,
    }


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

