from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone


def organization_timezone(organization):
    """Return a validated organization timezone, falling back to Django's configured zone."""
    name = getattr(organization, "timezone", "")
    if name:
        try:
            return ZoneInfo(name)
        except ZoneInfoNotFoundError:
            pass
    return timezone.get_default_timezone()


def patient_timezone(patient):
    return organization_timezone(getattr(patient, "organization", None))
