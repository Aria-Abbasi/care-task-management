import hashlib
from base64 import b64encode
from datetime import timedelta
from io import BytesIO

import qrcode
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db.models import Q
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, Throttled
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.ip import get_client_ip
from apps.common.permissions import IsCareAdmin

from .models import LoginAttempt, Organization, SessionToken
from .security import generate_totp_secret, totp_uri, verify_totp
from .serializers import (
    LoginSerializer,
    OrganizationSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    SessionTokenSerializer,
    UserSerializer,
)

User = get_user_model()


def _request_hashes(request, identifier):
    ip = get_client_ip(request)
    salt = settings.SECRET_KEY
    return (
        hashlib.sha256(f"{salt}:{identifier.lower()}".encode()).hexdigest(),
        hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest(),
    )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        identifier = str(request.data.get("login", ""))
        identifier_hash, ip_hash = _request_hashes(request, identifier)
        cutoff = timezone.now() - timedelta(minutes=settings.HAVEN_LOGIN_WINDOW_MINUTES)
        identifier_failures = LoginAttempt.objects.filter(identifier_hash=identifier_hash, succeeded=False, created_at__gte=cutoff).count()
        ip_failures = LoginAttempt.objects.filter(ip_hash=ip_hash, succeeded=False, created_at__gte=cutoff).count()
        if identifier_failures >= settings.HAVEN_LOGIN_MAX_FAILURES or ip_failures >= settings.HAVEN_LOGIN_MAX_FAILURES * 5:
            raise Throttled(
                wait=settings.HAVEN_LOGIN_WINDOW_MINUTES * 60,
                detail="Too many sign-in attempts. Try again later or reset the password.",
            )
        serializer = LoginSerializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            LoginAttempt.objects.create(identifier_hash=identifier_hash, ip_hash=ip_hash, succeeded=False)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.validated_data["user"]
        LoginAttempt.objects.create(identifier_hash=identifier_hash, ip_hash=ip_hash, succeeded=True)
        raw, session = SessionToken.issue(user=user, request=request)
        return Response(
            {
                "token": raw,
                "session_id": session.id,
                "expires_at": session.expires_at,
                "user": UserSerializer(user).data,
            }
        )


class LogoutView(APIView):
    def post(self, request):
        if isinstance(request.auth, SessionToken):
            request.auth.revoke()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)


class RotateSessionView(APIView):
    def post(self, request):
        current = request.auth
        if not isinstance(current, SessionToken):
            return Response({"detail": "This session cannot be rotated."}, status=status.HTTP_400_BAD_REQUEST)
        raw, session = SessionToken.issue(user=request.user, request=request, rotated_from=current)
        current.revoke()
        return Response(
            {"token": raw, "session_id": session.id, "expires_at": session.expires_at, "user": UserSerializer(request.user).data}
        )


class PasswordResetRequestView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        login = serializer.validated_data["login"]
        user = User.objects.filter(Q(email__iexact=login) | Q(username=login) | Q(phone=login), is_active=True).first()
        if user and user.email:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            reset_url = f"{settings.HAVEN_FRONTEND_URL.rstrip('/')}/reset-password?uid={uid}&token={token}"
            send_mail(
                "Reset your Haven password",
                f"Use this link to reset your password: {reset_url}\nIf you did not request this, ignore this message.",
                settings.DEFAULT_FROM_EMAIL,
                [user.email],
            )
        return Response({"detail": "If the account exists, reset instructions have been sent."}, status=status.HTTP_202_ACCEPTED)


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user_id = force_str(urlsafe_base64_decode(serializer.validated_data["uid"]))
            user = User.objects.get(pk=user_id, is_active=True)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response({"detail": "The reset link is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)
        if not default_token_generator.check_token(user, serializer.validated_data["token"]):
            return Response({"detail": "The reset link is invalid or expired."}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        user.session_tokens.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordChangeView(APIView):
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        sessions = request.user.session_tokens.filter(revoked_at__isnull=True)
        if isinstance(request.auth, SessionToken):
            sessions = sessions.exclude(pk=request.auth.pk)
        sessions.update(revoked_at=timezone.now())
        return Response(status=status.HTTP_204_NO_CONTENT)


class MfaViewSet(viewsets.ViewSet):
    def list(self, request):
        return Response({"enabled": request.user.mfa_enabled})

    @action(detail=False, methods=["post"])
    def setup(self, request):
        secret = generate_totp_secret()
        request.user.mfa_secret = secret
        request.user.mfa_enabled = False
        request.user.save(update_fields=["mfa_secret", "mfa_enabled"])
        uri = totp_uri(secret, request.user.email or request.user.username)
        image = qrcode.make(uri)
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return Response(
            {"secret": secret, "otpauth_uri": uri, "qr_code_data_url": f"data:image/png;base64,{b64encode(buffer.getvalue()).decode()}"}
        )

    @action(detail=False, methods=["post"])
    def confirm(self, request):
        if not verify_totp(request.user.mfa_secret, request.data.get("code")):
            return Response({"code": "Invalid or expired verification code."}, status=status.HTTP_400_BAD_REQUEST)
        request.user.mfa_enabled = True
        request.user.mfa_confirmed_at = timezone.now()
        request.user.save(update_fields=["mfa_enabled", "mfa_confirmed_at"])
        return Response({"enabled": True})

    @action(detail=False, methods=["post"])
    def disable(self, request):
        if not verify_totp(request.user.mfa_secret, request.data.get("code")):
            return Response({"code": "A valid verification code is required."}, status=status.HTTP_400_BAD_REQUEST)
        request.user.mfa_enabled = False
        request.user.mfa_secret = ""
        request.user.mfa_confirmed_at = None
        request.user.save(update_fields=["mfa_enabled", "mfa_secret", "mfa_confirmed_at"])
        return Response({"enabled": False})


class SessionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SessionTokenSerializer

    def get_queryset(self):
        return self.request.user.session_tokens.all()

    @action(detail=True, methods=["post"])
    def revoke(self, request, pk=None):
        session = self.get_object()
        session.revoke()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"])
    def revoke_others(self, request):
        queryset = self.get_queryset().filter(revoked_at__isnull=True)
        if isinstance(request.auth, SessionToken):
            queryset = queryset.exclude(pk=request.auth.pk)
        count = queryset.update(revoked_at=timezone.now())
        return Response({"revoked": count})


class OrganizationViewSet(viewsets.ModelViewSet):
    serializer_class = OrganizationSerializer

    def get_permissions(self):
        if self.action in {"create", "destroy"}:
            return [permissions.IsAdminUser()]
        if self.action in {"update", "partial_update"}:
            return [IsCareAdmin()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        if self.request.user.is_superuser:
            return Organization.objects.filter(active=True)
        user = self.request.user
        member_org_ids = list(user.organization_memberships.filter(active=True).values_list("organization_id", flat=True))
        if user.organization_id and user.organization_id not in member_org_ids:
            member_org_ids.append(user.organization_id)
        return Organization.objects.filter(id__in=member_org_ids, active=True)

    def perform_create(self, serializer):
        if not self.request.user.is_superuser:
            raise PermissionDenied("Only platform administrators can create organizations.")
        serializer.save()

    def perform_destroy(self, instance):
        if not self.request.user.is_superuser:
            raise PermissionDenied("Only platform administrators can deactivate organizations.")
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])

    @action(detail=True, methods=["post"])
    def switch(self, request, pk=None):
        org = self.get_object()
        user = request.user
        if not (
            user.is_superuser
            or user.organization_id == org.id
            or user.organization_memberships.filter(organization=org, active=True).exists()
        ):
            raise PermissionDenied("You do not have access to this organization.")
        user.organization = org
        user.save(update_fields=["organization"])
        return Response(UserSerializer(user, context={"request": request}).data)


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    search_fields = ["username", "email", "phone", "first_name", "last_name"]
    ordering_fields = ["first_name", "last_name", "date_joined"]

    def get_queryset(self):
        queryset = User.objects.select_related("organization").all().order_by("first_name", "last_name")
        if self.request.user.is_superuser:
            return queryset
        if self.request.user.role == User.Role.ADMIN:
            return queryset.filter(organization_id=self.request.user.organization_id)
        return queryset.filter(pk=self.request.user.pk)

    def get_permissions(self):
        if self.action in {"create", "destroy"}:
            return [IsCareAdmin()]
        return [permissions.IsAuthenticated()]

    def perform_create(self, serializer):
        if self.request.user.is_superuser:
            serializer.save()
        elif self.request.user.organization_id:
            serializer.save(organization=self.request.user.organization)
        else:
            raise PermissionDenied("An administrator must belong to an organization before creating users.")

    def perform_update(self, serializer):
        user = self.request.user
        protected_fields = {"role", "is_active", "organization"}.intersection(serializer.validated_data)
        if protected_fields and not (user.is_superuser or user.role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can change role, organization, or account status.")
        if not user.is_superuser and serializer.validated_data.get("organization", serializer.instance.organization) != user.organization:
            raise PermissionDenied("Administrators cannot move users outside their organization.")
        updated = serializer.save()
        if not updated.is_active:
            updated.session_tokens.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        instance.session_tokens.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
