from apps.accounts.models import Organization, OrganizationMembership


def get_active_organization_id(user, request=None):
    if not user or not getattr(user, "is_authenticated", False):
        return None

    header_org_val = None
    if request is not None:
        if hasattr(request, "headers"):
            header_org_val = request.headers.get("X-Organization-Id")
        if not header_org_val and hasattr(request, "META"):
            header_org_val = request.META.get("HTTP_X_ORGANIZATION_ID")

    if header_org_val:
        org = None
        if str(header_org_val).isdigit():
            org = Organization.objects.filter(pk=int(header_org_val), active=True).first()
        if not org:
            org = Organization.objects.filter(slug=str(header_org_val).strip(), active=True).first()

        if org:
            if user.is_superuser:
                return org.id
            if (
                user.organization_id == org.id
                or OrganizationMembership.objects.filter(user=user, organization=org, active=True).exists()
            ):
                return org.id

    if user.organization_id:
        return user.organization_id

    membership = (
        OrganizationMembership.objects.filter(user=user, active=True)
        .order_by("-is_default", "id")
        .select_related("organization")
        .first()
    )
    if membership:
        return membership.organization_id

    return None


def get_active_membership(user, request=None):
    if not user or not getattr(user, "is_authenticated", False):
        return None
    active_org_id = get_active_organization_id(user, request)
    if not active_org_id:
        return None
    return (
        OrganizationMembership.objects.filter(user=user, organization_id=active_org_id, active=True)
        .select_related("organization")
        .first()
    )


def get_tenant_role(user, request=None):
    """
    Returns the user's role in the active organization context.
    - Superusers always have 'ADMIN' role.
    - If active membership exists for the active organization, returns membership.role.
    - If user's primary organization matches active_org_id and no membership row exists, falls back to user.role.
    - Otherwise returns None.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return None
    if getattr(user, "is_superuser", False):
        return "ADMIN"
    active_org_id = get_active_organization_id(user, request)
    if not active_org_id:
        return None
    membership = OrganizationMembership.objects.filter(
        user=user, organization_id=active_org_id, active=True
    ).first()
    if membership:
        return membership.role
    if user.organization_id == active_org_id:
        return user.role
    return None
