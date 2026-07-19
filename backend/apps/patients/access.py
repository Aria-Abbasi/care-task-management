from apps.accounts.models import User

from .models import Patient


def patients_for_user(user):
    queryset = Patient.objects.filter(active=True).order_by("first_name", "last_name")
    if user.is_superuser:
        return queryset
    if user.organization_id:
        queryset = queryset.filter(organization_id=user.organization_id)
    if user.role == User.Role.ADMIN:
        return queryset if user.organization_id else queryset.none()
    return queryset.filter(care_assignments__user=user, care_assignments__active=True).distinct()
