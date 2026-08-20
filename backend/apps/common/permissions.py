from rest_framework.permissions import BasePermission

from apps.accounts.context import get_tenant_role
from apps.accounts.models import User


class IsCareAdmin(BasePermission):
    message = "Administrator access is required."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        tenant_role = get_tenant_role(request.user, request)
        return tenant_role == User.Role.ADMIN
