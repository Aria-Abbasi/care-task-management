from datetime import timedelta
from zoneinfo import ZoneInfo

from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone

from apps.care_tasks.models import TaskOccurrence
from apps.medications.models import DoseLog
from apps.patients.models import CareAssignment

from .models import (
    AuditEvent,
    CareNotification,
    EscalationPolicy,
    EscalationStep,
    NotificationDelivery,
    NotificationPreference,
)


def record_audit(*, actor, patient, action, instance, summary, metadata=None, client_reference=None):
    values = {
        "actor": actor if getattr(actor, "is_authenticated", False) else None,
        "patient": patient,
        "action": action,
        "entity_type": instance.__class__.__name__,
        "entity_id": str(instance.pk),
        "summary": summary,
        "metadata": metadata or {},
        "client_reference": client_reference,
    }
    if client_reference:
        event, _ = AuditEvent.objects.get_or_create(client_reference=client_reference, defaults=values)
        return event
    try:
        return AuditEvent.objects.create(**values)
    except IntegrityError:
        return AuditEvent.objects.get(client_reference=client_reference)


def _alert_values(kind, source, due_at, minutes_overdue):
    level = 3 if minutes_overdue >= 120 else 2 if minutes_overdue >= 60 else 1
    severity = CareNotification.Severity.CRITICAL if level >= 2 else CareNotification.Severity.WARNING
    if kind == CareNotification.Kind.TASK_OVERDUE:
        title = f"Overdue care: {source.task.title}"
        message = f"Scheduled care is {int(minutes_overdue)} minutes overdue. Please record an outcome or escalate."
        patient = source.task.patient
        source_type = "task_occurrence"
    else:
        title = f"Medication overdue: {source.medication.name}"
        message = f"The scheduled {source.medication.dose:g} {source.medication.unit} dose is {int(minutes_overdue)} minutes overdue."
        patient = source.medication.patient
        source_type = "dose_log"
    return patient, source_type, level, severity, title, message


def _upsert_alert(*, kind, source, due_at, now):
    minutes_overdue = max(0, (now - due_at).total_seconds() / 60)
    patient, source_type, level, severity, title, message = _alert_values(kind, source, due_at, minutes_overdue)
    assignments = CareAssignment.objects.filter(patient=patient, active=True, user__is_active=True).select_related("user")
    created = 0
    escalated = 0
    for assignment in assignments:
        notification, was_created = CareNotification.objects.get_or_create(
            recipient=assignment.user,
            kind=kind,
            source_type=source_type,
            source_id=str(source.pk),
            defaults={
                "patient": patient,
                "severity": severity,
                "title": title,
                "message": message,
                "escalation_level": level,
                "due_at": due_at,
            },
        )
        created += int(was_created)
        if not was_created and level > notification.escalation_level:
            notification.escalation_level = level
            notification.severity = severity
            notification.message = message
            notification.state = CareNotification.State.UNREAD
            notification.acknowledged_at = None
            notification.snoozed_until = None
            notification.save(
                update_fields=["escalation_level", "severity", "message", "state", "acknowledged_at", "snoozed_until", "updated_at"]
            )
            escalated += 1
        queue_notification_deliveries(notification, now=now)
    return created, escalated


def _inside_quiet_hours(preference, now):
    if not preference.quiet_hours_start or not preference.quiet_hours_end:
        return False
    try:
        local_time = timezone.localtime(now, ZoneInfo(preference.timezone)).time()
    except (KeyError, ValueError):
        local_time = timezone.localtime(now).time()
    start = preference.quiet_hours_start
    end = preference.quiet_hours_end
    return start <= local_time < end if start < end else local_time >= start or local_time < end


def queue_notification_deliveries(notification, now=None):
    now = now or timezone.now()
    preference, _ = NotificationPreference.objects.get_or_create(
        user=notification.recipient,
        defaults={"timezone": getattr(notification.recipient.organization, "timezone", "UTC") or "UTC"},
    )
    policy = (
        EscalationPolicy.objects.filter(organization=notification.recipient.organization, active=True, is_default=True)
        .prefetch_related("steps")
        .first()
        if notification.recipient.organization_id
        else None
    )
    if policy:
        steps = [step for step in policy.steps.all() if step.level <= notification.escalation_level]
    else:
        defaults = [
            (1, EscalationStep.Channel.PUSH),
            (2, EscalationStep.Channel.SMS),
            (3, EscalationStep.Channel.VOICE),
        ]
        steps = [
            type("DefaultStep", (), {"channel": channel, "recipient_roles": [], "delay_minutes": 0})
            for level, channel in defaults
            if level <= notification.escalation_level
        ]
    created = 0
    for step in steps:
        if step.recipient_roles and notification.recipient.role not in step.recipient_roles:
            continue
        enabled = {
            EscalationStep.Channel.PUSH: preference.push_enabled,
            EscalationStep.Channel.SMS: preference.sms_enabled,
            EscalationStep.Channel.VOICE: preference.voice_enabled,
            EscalationStep.Channel.IN_APP: True,
        }[step.channel]
        quiet = _inside_quiet_hours(preference, now)
        suppressed = not enabled or (
            quiet and not (notification.severity == CareNotification.Severity.CRITICAL and preference.critical_override)
        )
        delivery_time = max(now, notification.due_at + timedelta(minutes=getattr(step, "delay_minutes", 0)))
        delivery, was_created = NotificationDelivery.objects.get_or_create(
            notification=notification,
            channel=step.channel,
            defaults={
                "status": NotificationDelivery.Status.SUPPRESSED if suppressed else NotificationDelivery.Status.PENDING,
                "next_attempt_at": delivery_time,
                "destination_hint": _destination_hint(notification.recipient, step.channel),
            },
        )
        if was_created:
            created += 1
        elif suppressed and delivery.status in {NotificationDelivery.Status.PENDING, NotificationDelivery.Status.FAILED}:
            delivery.status = NotificationDelivery.Status.SUPPRESSED
            delivery.save(update_fields=["status", "updated_at"])
        elif delivery.status == NotificationDelivery.Status.SUPPRESSED and not suppressed:
            delivery.status = NotificationDelivery.Status.PENDING
            delivery.next_attempt_at = delivery_time
            delivery.save(update_fields=["status", "next_attempt_at", "updated_at"])
    return created


def _destination_hint(user, channel):
    if channel in {EscalationStep.Channel.SMS, EscalationStep.Channel.VOICE}:
        return f"***{user.phone[-4:]}" if user.phone else "missing phone"
    if channel == EscalationStep.Channel.PUSH:
        return "registered browser devices"
    return "in-app"


def scan_overdue_alerts(now=None, grace_minutes=30):
    now = now or timezone.now()
    cutoff = now - timedelta(minutes=grace_minutes)
    task_filter = Q(delayed_until__isnull=True, scheduled_at__lt=now) | Q(delayed_until__lt=now)
    occurrences = TaskOccurrence.objects.filter(
        task_filter,
        status__in=[
            TaskOccurrence.Status.PENDING,
            TaskOccurrence.Status.MISSED,
            TaskOccurrence.Status.DELAYED,
        ],
    ).select_related("task", "task__patient", "schedule")
    doses = DoseLog.objects.filter(status=DoseLog.Status.SCHEDULED, scheduled_at__lt=cutoff).select_related(
        "medication", "medication__patient"
    )
    created = escalated = 0
    for occurrence in occurrences:
        due_at = occurrence.delayed_until or occurrence.scheduled_at
        allowed_minutes = occurrence.schedule.window_after_minutes if occurrence.schedule else grace_minutes
        if due_at + timedelta(minutes=allowed_minutes) >= now:
            continue
        values = _upsert_alert(
            kind=CareNotification.Kind.TASK_OVERDUE,
            source=occurrence,
            due_at=due_at,
            now=now,
        )
        created += values[0]
        escalated += values[1]
    for dose in doses:
        values = _upsert_alert(kind=CareNotification.Kind.DOSE_OVERDUE, source=dose, due_at=dose.scheduled_at, now=now)
        created += values[0]
        escalated += values[1]
    return {"created": created, "escalated": escalated}


def resolve_source_alerts(source_type, source_id):
    notifications = CareNotification.objects.filter(
        source_type=source_type,
        source_id=str(source_id),
        state__in=[CareNotification.State.UNREAD, CareNotification.State.READ, CareNotification.State.SNOOZED],
    )
    notification_ids = list(notifications.values_list("id", flat=True))
    updated = notifications.update(
        state=CareNotification.State.ACKNOWLEDGED,
        acknowledged_at=timezone.now(),
        snoozed_until=None,
    )
    NotificationDelivery.objects.filter(
        notification_id__in=notification_ids,
        status__in=[NotificationDelivery.Status.PENDING, NotificationDelivery.Status.FAILED],
    ).update(status=NotificationDelivery.Status.SUPPRESSED, error="Care outcome resolved the alert.")
    return updated
