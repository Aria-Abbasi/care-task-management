from django.utils import timezone

from apps.patients.models import CareAssignment
from apps.safety.models import CareNotification
from apps.safety.services import queue_notification_deliveries

from .models import VitalThreshold


def reading_outside_threshold(reading, threshold):
    if threshold.minimum is not None and reading.value < threshold.minimum:
        return True
    if threshold.maximum is not None and reading.value > threshold.maximum:
        return True
    if reading.secondary_value is not None:
        if threshold.secondary_minimum is not None and reading.secondary_value < threshold.secondary_minimum:
            return True
        if threshold.secondary_maximum is not None and reading.secondary_value > threshold.secondary_maximum:
            return True
    return False


def evaluate_vital_threshold(reading):
    threshold = VitalThreshold.objects.filter(patient=reading.patient, vital_type=reading.type, active=True).first()
    if not threshold:
        return 0
    recent = list(reading.patient.vital_records.filter(type=reading.type)[: threshold.consecutive_readings])
    if len(recent) < threshold.consecutive_readings or not all(reading_outside_threshold(item, threshold) for item in recent):
        return 0
    created = 0
    for assignment in CareAssignment.objects.filter(patient=reading.patient, active=True).select_related("user"):
        notification, was_created = CareNotification.objects.get_or_create(
            recipient=assignment.user,
            patient=reading.patient,
            kind=CareNotification.Kind.VITAL_ALERT,
            source_type="vital_record",
            source_id=str(reading.id),
            defaults={
                "severity": threshold.severity,
                "title": f"{reading.get_type_display()} needs review",
                "message": "A clinician-defined vital threshold was crossed. Review the readings and care plan; Haven has not made a diagnosis.",
                "escalation_level": 2 if threshold.severity == "CRITICAL" else 1,
                "due_at": timezone.now(),
            },
        )
        queue_notification_deliveries(notification)
        created += int(was_created)
    return created
