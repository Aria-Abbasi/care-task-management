from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.context import get_active_organization_id, get_tenant_role
from apps.accounts.models import User
from apps.patients.access import patients_for_user
from apps.patients.models import CareAssignment
from apps.safety.models import CareNotification
from apps.safety.services import queue_notification_deliveries, record_audit

from .models import CaregiverAvailability, Conversation, Message, MessageReadReceipt, ShiftAssignment
from .serializers import (
    CaregiverAvailabilitySerializer,
    ConversationSerializer,
    MessageSerializer,
    ShiftAssignmentSerializer,
)


class ConversationViewSet(viewsets.ModelViewSet):
    serializer_class = ConversationSerializer
    filterset_fields = ["patient", "kind", "active"]
    search_fields = ["title"]
    ordering_fields = ["updated_at", "created_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user, self.request).values_list("id", flat=True)
        return (
            Conversation.objects.filter(patient_id__in=patient_ids, participants=self.request.user)
            .select_related("patient", "created_by")
            .prefetch_related("participants")
            .distinct()
        )

    def perform_create(self, serializer):
        patient = serializer.validated_data["patient"]
        if not patients_for_user(self.request.user, self.request).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        participants = serializer.validated_data.get("participants", [])
        assigned_ids = set(CareAssignment.objects.filter(patient=patient, active=True).values_list("user_id", flat=True))
        if any(user.id not in assigned_ids for user in participants):
            raise PermissionDenied("Conversation participants must be assigned to the patient.")
        conversation = serializer.save(created_by=self.request.user)
        conversation.participants.add(self.request.user)

    def perform_update(self, serializer):
        conversation = serializer.instance
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (
            self.request.user.is_superuser or tenant_role == User.Role.ADMIN or conversation.created_by == self.request.user
        ):
            raise PermissionDenied("Only the conversation owner or an administrator can change participants.")
        patient = serializer.validated_data.get("patient", conversation.patient)
        participants = serializer.validated_data.get("participants", conversation.participants.all())
        assigned_ids = set(CareAssignment.objects.filter(patient=patient, active=True).values_list("user_id", flat=True))
        if any(user.id not in assigned_ids for user in participants):
            raise PermissionDenied("Conversation participants must be assigned to the patient.")
        serializer.save()

    def perform_destroy(self, instance):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can archive conversations.")
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])


class MessageViewSet(viewsets.ModelViewSet):
    serializer_class = MessageSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["conversation", "clinical", "urgent", "sender"]
    ordering_fields = ["created_at"]

    def get_queryset(self):
        return (
            Message.objects.filter(conversation__participants=self.request.user)
            .select_related("conversation", "conversation__patient", "sender")
            .prefetch_related("mentions", "read_receipts", "read_receipts__user")
        )

    def create(self, request, *args, **kwargs):
        reference = request.data.get("client_reference")
        if reference:
            existing = self.get_queryset().filter(client_reference=reference).first()
            if existing:
                return Response(self.get_serializer(existing).data)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        conversation = serializer.validated_data["conversation"]
        if not conversation.participants.filter(pk=self.request.user.pk).exists():
            raise PermissionDenied("You do not belong to this conversation.")
        message = serializer.save(sender=self.request.user)
        conversation.save(update_fields=["updated_at"])
        record_audit(
            actor=self.request.user,
            patient=conversation.patient,
            action="MESSAGE_SENT",
            instance=message,
            summary=f"Sent {conversation.get_kind_display().lower()} message",
            metadata={"urgent": message.urgent, "has_attachment": bool(message.attachment or message.voice_note)},
            client_reference=message.client_reference,
        )
        if message.urgent:
            for recipient in conversation.participants.exclude(pk=self.request.user.pk):
                notification, _ = CareNotification.objects.get_or_create(
                    recipient=recipient,
                    patient=conversation.patient,
                    kind=CareNotification.Kind.URGENT_MESSAGE,
                    source_type="message",
                    source_id=str(message.id),
                    defaults={
                        "severity": CareNotification.Severity.CRITICAL,
                        "title": "Urgent care-team message",
                        "message": "An urgent patient-specific message needs acknowledgement.",
                        "escalation_level": 2,
                        "due_at": timezone.now(),
                    },
                )
                queue_notification_deliveries(notification)

    def perform_update(self, serializer):
        message = serializer.instance
        if message.sender != self.request.user:
            raise PermissionDenied("Only the sender can edit a message.")
        message = serializer.save(edited_at=timezone.now())
        record_audit(
            actor=self.request.user,
            patient=message.conversation.patient,
            action="MESSAGE_EDITED",
            instance=message,
            summary="Edited patient-specific message",
        )

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        message = self.get_object()
        receipt, _ = MessageReadReceipt.objects.get_or_create(message=message, user=request.user)
        return Response({"read_at": receipt.read_at})

    @action(detail=True, methods=["get"])
    def attachment(self, request, pk=None):
        message = self.get_object()
        if not message.attachment:
            raise PermissionDenied("No attachment is available.")
        record_audit(
            actor=request.user,
            patient=message.conversation.patient,
            action="MESSAGE_ATTACHMENT_DOWNLOADED",
            instance=message,
            summary="Downloaded secure message attachment",
        )
        return FileResponse(message.attachment.open("rb"), as_attachment=True, filename=message.attachment.name.rsplit("/", 1)[-1])

    @action(detail=True, methods=["get"], url_path="voice-note")
    def voice_note(self, request, pk=None):
        message = self.get_object()
        if not message.voice_note:
            raise PermissionDenied("No voice note is available.")
        record_audit(
            actor=request.user,
            patient=message.conversation.patient,
            action="MESSAGE_VOICE_DOWNLOADED",
            instance=message,
            summary="Downloaded secure message voice note",
        )
        return FileResponse(message.voice_note.open("rb"), as_attachment=True, filename=message.voice_note.name.rsplit("/", 1)[-1])


class ShiftAssignmentViewSet(viewsets.ModelViewSet):
    serializer_class = ShiftAssignmentSerializer
    filterset_fields = ["patient", "caregiver", "status"]
    ordering_fields = ["starts_at", "ends_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user, self.request).values_list("id", flat=True)
        queryset = ShiftAssignment.objects.filter(patient_id__in=patient_ids).select_related("patient", "caregiver")
        tenant_role = get_tenant_role(self.request.user, self.request)
        if tenant_role == User.Role.CAREGIVER:
            queryset = queryset.filter(Q(caregiver=self.request.user) | Q(patient__care_assignments__user=self.request.user)).distinct()
        return queryset

    def perform_create(self, serializer):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators schedule shifts.")
        patient = serializer.validated_data["patient"]
        caregiver = serializer.validated_data["caregiver"]
        if not CareAssignment.objects.filter(patient=patient, user=caregiver, active=True).exists():
            raise PermissionDenied("The caregiver must be assigned to the patient.")
        serializer.save()

    def perform_update(self, serializer):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can edit shift assignments.")
        patient = serializer.validated_data.get("patient", serializer.instance.patient)
        caregiver = serializer.validated_data.get("caregiver", serializer.instance.caregiver)
        if not CareAssignment.objects.filter(patient=patient, user=caregiver, active=True).exists():
            raise PermissionDenied("The caregiver must be assigned to the patient.")
        serializer.save()

    def perform_destroy(self, instance):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can cancel shift assignments.")
        instance.status = ShiftAssignment.Status.CANCELED
        instance.save(update_fields=["status", "updated_at"])

    def _transition(self, assignment, new_status, timestamp_field):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if assignment.caregiver != self.request.user and not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only the assigned caregiver can update this shift.")
        setattr(assignment, timestamp_field, timezone.now())
        assignment.status = new_status
        assignment.save(update_fields=[timestamp_field, "status", "updated_at"])
        return Response(self.get_serializer(assignment).data)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        return self._transition(self.get_object(), ShiftAssignment.Status.ACCEPTED, "accepted_at")

    @action(detail=True, methods=["post"])
    def check_in(self, request, pk=None):
        return self._transition(self.get_object(), ShiftAssignment.Status.IN_PROGRESS, "checked_in_at")

    @action(detail=True, methods=["post"])
    def check_out(self, request, pk=None):
        return self._transition(self.get_object(), ShiftAssignment.Status.COMPLETED, "checked_out_at")


class CaregiverAvailabilityViewSet(viewsets.ModelViewSet):
    serializer_class = CaregiverAvailabilitySerializer
    filterset_fields = ["caregiver", "available"]
    ordering_fields = ["starts_at", "ends_at"]

    def get_queryset(self):
        queryset = CaregiverAvailability.objects.select_related("caregiver", "caregiver__organization")
        if self.request.user.is_superuser:
            return queryset
        tenant_role = get_tenant_role(self.request.user, self.request)
        active_org_id = get_active_organization_id(self.request.user, self.request)
        if tenant_role == User.Role.ADMIN and active_org_id:
            return queryset.filter(caregiver__organization_id=active_org_id)
        return queryset.filter(caregiver=self.request.user)

    def perform_create(self, serializer):
        caregiver = serializer.validated_data.get("caregiver", self.request.user)
        tenant_role = get_tenant_role(self.request.user, self.request)
        active_org_id = get_active_organization_id(self.request.user, self.request)
        if caregiver != self.request.user and not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can record another caregiver's availability.")
        if not self.request.user.is_superuser and active_org_id:
            caregiver_org_ids = set(caregiver.organization_memberships.filter(active=True).values_list("organization_id", flat=True))
            if caregiver.organization_id:
                caregiver_org_ids.add(caregiver.organization_id)
            if active_org_id not in caregiver_org_ids:
                raise PermissionDenied("Availability must remain inside the organization.")
        serializer.save(caregiver=caregiver)
