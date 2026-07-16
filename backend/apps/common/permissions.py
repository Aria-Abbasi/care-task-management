from rest_framework.permissions import BasePermission

from apps.accounts.models import User


class IsCareAdmin(BasePermission):
    message = "Administrator access is required."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and (request.user.is_superuser or request.user.role == User.Role.ADMIN))
