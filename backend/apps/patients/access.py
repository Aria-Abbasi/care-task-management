from apps.accounts.context import get_active_organization_id, get_tenant_role
from apps.accounts.models import OrganizationMembership, User

from .models import Patient


def patients_for_user(user, request=None):
    queryset = Patient.objects.filter(active=True).order_by("first_name", "last_name")
    if not user or not getattr(user, "is_authenticated", False):
        return queryset.none()

    active_org_id = get_active_organization_id(user, request)

    if user.is_superuser:
        if active_org_id:
            return queryset.filter(organization_id=active_org_id)
        return queryset

    if active_org_id:
        queryset = queryset.filter(organization_id=active_org_id)
    else:
        user_org_ids = list(
            OrganizationMembership.objects.filter(user=user, active=True).values_list("organization_id", flat=True)
        )
        if user.organization_id and user.organization_id not in user_org_ids:
            user_org_ids.append(user.organization_id)
        if user_org_ids:
            queryset = queryset.filter(organization_id__in=user_org_ids)
        else:
            return queryset.none()

    tenant_role = get_tenant_role(user, request)
    if tenant_role == User.Role.ADMIN:
        return queryset
    return queryset.filter(care_assignments__user=user, care_assignments__active=True).distinct()
