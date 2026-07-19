import hashlib
import hmac
import json
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.permissions import IsCareAdmin
from apps.patients.access import patients_for_user

from .models import (
    AuditEvent,
    CareNotification,
    EscalationPolicy,
    EscalationStep,
    NotificationDelivery,
    NotificationPreference,
    PushSubscription,
)
from .serializers import (
    AuditEventSerializer,
    CareNotificationSerializer,
    EscalationPolicySerializer,
    EscalationStepSerializer,
    NotificationDeliverySerializer,
    NotificationPreferenceSerializer,
    PushSubscriptionSerializer,
)
from .services import record_audit, scan_overdue_alerts


class AuditEventViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditEventSerializer
    filterset_fields = ["patient", "action", "entity_type", "entity_id", "actor"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return AuditEvent.objects.filter(patient_id__in=patient_ids).select_related("actor", "patient")

    @action(detail=False, methods=["get"])
    def signed_export(self, request):
        patient_id = request.query_params.get("patient")
        queryset = self.get_queryset()
        if patient_id:
            queryset = queryset.filter(patient_id=patient_id)
        events = AuditEventSerializer(queryset[:5000], many=True).data
        payload = json.dumps({"generated_at": timezone.now().isoformat(), "events": events}, sort_keys=True, separators=(",", ":"))
        signature = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return Response({"algorithm": "HMAC-SHA256", "signature": signature, "payload": json.loads(payload)})


class CareNotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = CareNotificationSerializer
    filterset_fields = ["patient", "kind", "severity", "state"]
    ordering_fields = ["created_at", "due_at", "severity"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return (
            CareNotification.objects.filter(recipient=self.request.user, patient_id__in=patient_ids)
            .select_related("patient")
            .prefetch_related("deliveries")
        )

    @action(detail=False, methods=["post"])
    def refresh(self, request):
        scan_overdue_alerts()
        return Response(self.get_serializer(self.get_queryset()[:50], many=True).data)

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()
        notification.state = CareNotification.State.READ
        notification.read_at = timezone.now()
        notification.save(update_fields=["state", "read_at", "updated_at"])
        return Response(self.get_serializer(notification).data)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        notification = self.get_object()
        notification.state = CareNotification.State.ACKNOWLEDGED
        notification.acknowledged_at = timezone.now()
        notification.save(update_fields=["state", "acknowledged_at", "updated_at"])
        notification.deliveries.filter(status__in=[NotificationDelivery.Status.PENDING, NotificationDelivery.Status.FAILED]).update(
            status=NotificationDelivery.Status.SUPPRESSED, error="Alert acknowledged before delivery."
        )
        record_audit(
            actor=request.user,
            patient=notification.patient,
            action="NOTIFICATION_ACKNOWLEDGED",
            instance=notification,
            summary=f"Acknowledged alert: {notification.title}",
            metadata={"escalation_level": notification.escalation_level},
        )
        return Response(self.get_serializer(notification).data)

    @action(detail=True, methods=["post"])
    def snooze(self, request, pk=None):
        notification = self.get_object()
        try:
            minutes = min(60, max(5, int(request.data.get("minutes", 15))))
        except (TypeError, ValueError):
            return Response({"minutes": "Use a number from 5 to 60."}, status=status.HTTP_400_BAD_REQUEST)
        notification.state = CareNotification.State.SNOOZED
        notification.snoozed_until = timezone.now() + timedelta(minutes=minutes)
        notification.save(update_fields=["state", "snoozed_until", "updated_at"])
        notification.deliveries.filter(status__in=[NotificationDelivery.Status.PENDING, NotificationDelivery.Status.FAILED]).update(
            next_attempt_at=notification.snoozed_until
        )
        record_audit(
            actor=request.user,
            patient=notification.patient,
            action="NOTIFICATION_SNOOZED",
            instance=notification,
            summary=f"Snoozed alert for {minutes} minutes",
            metadata={"minutes": minutes},
        )
        return Response(self.get_serializer(notification).data)


class NotificationPreferenceViewSet(viewsets.ViewSet):
    def list(self, request):
        preference, _ = NotificationPreference.objects.get_or_create(
            user=request.user,
            defaults={"timezone": getattr(request.user.organization, "timezone", "UTC") or "UTC"},
        )
        return Response(NotificationPreferenceSerializer(preference).data)

    def partial_update(self, request, pk=None):
        preference, _ = NotificationPreference.objects.get_or_create(user=request.user)
        serializer = NotificationPreferenceSerializer(preference, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PushSubscriptionViewSet(viewsets.ModelViewSet):
    serializer_class = PushSubscriptionSerializer
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return PushSubscription.objects.filter(user=self.request.user)

    @action(detail=False, methods=["get"])
    def config(self, request):
        return Response({"public_key": settings.HAVEN_VAPID_PUBLIC_KEY, "configured": bool(settings.HAVEN_VAPID_PUBLIC_KEY)})

    def create(self, request, *args, **kwargs):
        existing = PushSubscription.objects.filter(endpoint=request.data.get("endpoint")).first()
        if existing:
            existing.user = request.user
            existing.p256dh = request.data.get("p256dh", existing.p256dh)
            existing.auth = request.data.get("auth", existing.auth)
            existing.device_name = request.data.get("device_name", existing.device_name)
            existing.user_agent = request.META.get("HTTP_USER_AGENT", "")[:500]
            existing.active = True
            existing.failure_count = 0
            existing.save()
            return Response(self.get_serializer(existing).data)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user, user_agent=self.request.META.get("HTTP_USER_AGENT", "")[:500])

    def perform_destroy(self, instance):
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])


class EscalationPolicyViewSet(viewsets.ModelViewSet):
    serializer_class = EscalationPolicySerializer
    permission_classes = [IsCareAdmin]

    def get_queryset(self):
        queryset = EscalationPolicy.objects.prefetch_related("steps")
        return queryset if self.request.user.is_superuser else queryset.filter(organization_id=self.request.user.organization_id)

    def perform_create(self, serializer):
        organization = serializer.validated_data["organization"]
        if not self.request.user.is_superuser and organization != self.request.user.organization:
            raise PermissionDenied("Cannot create a policy for another organization.")
        serializer.save()

    def perform_update(self, serializer):
        organization = serializer.validated_data.get("organization", serializer.instance.organization)
        if not self.request.user.is_superuser and organization != self.request.user.organization:
            raise PermissionDenied("Cannot move a policy outside your organization.")
        serializer.save()


class EscalationStepViewSet(viewsets.ModelViewSet):
    serializer_class = EscalationStepSerializer
    permission_classes = [IsCareAdmin]

    def get_queryset(self):
        queryset = EscalationStep.objects.select_related("policy", "policy__organization")
        return queryset if self.request.user.is_superuser else queryset.filter(policy__organization_id=self.request.user.organization_id)


class NotificationDeliveryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationDeliverySerializer
    permission_classes = [IsCareAdmin]
    filterset_fields = ["channel", "status", "notification"]

    def get_queryset(self):
        queryset = NotificationDelivery.objects.select_related("notification", "notification__recipient")
        return (
            queryset
            if self.request.user.is_superuser
            else queryset.filter(notification__recipient__organization_id=self.request.user.organization_id)
        )

    def perform_create(self, serializer):
        policy = serializer.validated_data["policy"]
        if not self.request.user.is_superuser and policy.organization != self.request.user.organization:
            raise PermissionDenied("Cannot add steps to another organization's policy.")
        serializer.save()

    def perform_update(self, serializer):
        policy = serializer.validated_data.get("policy", serializer.instance.policy)
        if not self.request.user.is_superuser and policy.organization != self.request.user.organization:
            raise PermissionDenied("Cannot move steps outside your organization.")
        serializer.save()

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        delivery = self.get_object()
        delivery.status = NotificationDelivery.Status.PENDING
        delivery.attempts = 0
        delivery.error = ""
        delivery.next_attempt_at = timezone.now()
        delivery.save(update_fields=["status", "attempts", "error", "next_attempt_at", "updated_at"])
        return Response(self.get_serializer(delivery).data)


class DeliveryReceiptView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, channel):
        receipt_token = request.data.get("receipt") or request.query_params.get("receipt")
        if receipt_token:
            delivery = NotificationDelivery.objects.filter(receipt_token=receipt_token).first()
        elif channel == "web-push":
            delivery = None
        else:
            if request.query_params.get("secret", "") != settings.HAVEN_DELIVERY_WEBHOOK_SECRET:
                return Response(status=status.HTTP_403_FORBIDDEN)
            provider_id = request.data.get("MessageSid") or request.data.get("CallSid")
            delivery = NotificationDelivery.objects.filter(provider_id=provider_id).first()
        if not delivery:
            return Response(status=status.HTTP_404_NOT_FOUND)
        provider_status = str(request.data.get("MessageStatus") or request.data.get("CallStatus") or "delivered").lower()
        if provider_status in {"delivered", "completed"}:
            delivery.status = NotificationDelivery.Status.DELIVERED
            delivery.delivered_at = timezone.now()
        elif provider_status in {"failed", "undelivered", "canceled"}:
            delivery.status = NotificationDelivery.Status.FAILED
            delivery.error = f"Provider reported {provider_status}."
            delivery.next_attempt_at = timezone.now()
        delivery.save(update_fields=["status", "delivered_at", "error", "next_attempt_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
