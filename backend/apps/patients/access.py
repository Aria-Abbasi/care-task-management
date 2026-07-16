from apps.accounts.models import User

from .models import Patient


def patients_for_user(user):
    queryset = Patient.objects.filter(active=True).order_by("first_name", "last_name")
    if user.is_superuser or user.role == User.Role.ADMIN:
        return queryset
    return queryset.filter(care_assignments__user=user, care_assignments__active=True).distinct()
