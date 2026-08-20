from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.context import get_active_organization_id, get_tenant_role
from apps.accounts.models import User
from apps.common.permissions import IsCareAdmin
from apps.patients.access import patients_for_user
from apps.safety.services import record_audit

from .models import DoseLog, Medication, MedicationInteraction, RefillRequest, StockAdjustment
from .serializers import (
    AdministerDoseSerializer,
    CorrectDoseSerializer,
    DoseLogSerializer,
    DoseOutcomeSerializer,
    MedicationInteractionSerializer,
    MedicationSerializer,
    RefillRequestSerializer,
    StockAdjustmentSerializer,
)


class MedicationViewSet(viewsets.ModelViewSet):
    serializer_class = MedicationSerializer
    filterset_fields = ["patient", "active"]
    search_fields = ["name", "instructions"]
    ordering_fields = ["name", "created_at", "stock_quantity"]

    def _require_clinician(self):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR}):
            raise PermissionDenied("A clinician or administrator must change medication orders.")

    def _require_care_role(self):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot administer medication.")

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user, self.request).values_list("id", flat=True)
        return Medication.objects.filter(patient_id__in=patient_ids).select_related("patient").prefetch_related("schedules")

    def _validate_patient(self, patient):
        if not patients_for_user(self.request.user, self.request).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")

    def perform_create(self, serializer):
        self._require_clinician()
        self._validate_patient(serializer.validated_data["patient"])
        medication = serializer.save(approval_status=Medication.ApprovalStatus.PENDING)
        record_audit(
            actor=self.request.user,
            patient=medication.patient,
            action="MEDICATION_CREATED",
            instance=medication,
            summary=f"Added medication order: {medication.name}",
        )

    def perform_update(self, serializer):
        self._require_clinician()
        self._validate_patient(serializer.validated_data.get("patient", serializer.instance.patient))
        medication = serializer.save(approval_status=Medication.ApprovalStatus.PENDING, approved_by=None, approved_at=None)
        record_audit(
            actor=self.request.user,
            patient=medication.patient,
            action="MEDICATION_UPDATED",
            instance=medication,
            summary=f"Updated medication order: {medication.name}",
        )

    def perform_destroy(self, instance):
        self._require_clinician()
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])
        record_audit(
            actor=self.request.user,
            patient=instance.patient,
            action="MEDICATION_DEACTIVATED",
            instance=instance,
            summary=f"Deactivated medication order: {instance.name}",
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        self._require_clinician()
        medication = self.get_object()
        medication.approval_status = Medication.ApprovalStatus.APPROVED
        medication.approved_by = request.user
        medication.approved_at = timezone.now()
        medication.save(update_fields=["approval_status", "approved_by", "approved_at", "updated_at"])
        record_audit(
            actor=request.user,
            patient=medication.patient,
            action="MEDICATION_APPROVED",
            instance=medication,
            summary=f"Approved medication order: {medication.name}",
        )
        return Response(self.get_serializer(medication).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        self._require_clinician()
        medication = self.get_object()
        medication.approval_status = Medication.ApprovalStatus.REJECTED
        medication.active = False
        medication.save(update_fields=["approval_status", "active", "updated_at"])
        record_audit(
            actor=request.user,
            patient=medication.patient,
            action="MEDICATION_REJECTED",
            instance=medication,
            summary=f"Rejected medication order: {medication.name}",
            metadata={"reason": request.data.get("reason", "")},
        )
        return Response(self.get_serializer(medication).data)

    @action(detail=False, methods=["get"])
    def barcode(self, request):
        code = request.query_params.get("code", "")
        if not code:
            return Response({"code": "A barcode is required."}, status=status.HTTP_400_BAD_REQUEST)
        medication = self.get_queryset().filter(barcode=code, active=True).first()
        if not medication:
            return Response({"detail": "No active medication matches this barcode."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(medication).data)

    @transaction.atomic
    @action(detail=True, methods=["post"], url_path="prn-dose")
    def prn_dose(self, request, pk=None):
        self._require_care_role()
        medication = self.get_object()
        if not medication.is_prn:
            return Response({"detail": "This is not an as-needed medication order."}, status=status.HTTP_400_BAD_REQUEST)
        dose = DoseLog.objects.create(medication=medication, scheduled_at=timezone.now(), is_prn=True)
        payload = {**request.data, "expected_version": 1}
        serializer = AdministerDoseSerializer(data=payload, context={"request": request, "dose": dose})
        serializer.is_valid(raise_exception=True)
        dose = serializer.save()
        return Response(DoseLogSerializer(dose, context={"request": request}).data, status=status.HTTP_201_CREATED)


class DoseLogViewSet(viewsets.ModelViewSet):
    serializer_class = DoseLogSerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["medication", "medication__patient", "status"]
    ordering_fields = ["scheduled_at", "administered_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user, self.request).values_list("id", flat=True)
        return (
            DoseLog.objects.filter(medication__patient_id__in=patient_ids)
            .select_related("medication", "medication__patient", "administered_by")
            .prefetch_related("corrections", "corrections__corrected_by")
        )

    def _require_care_role(self):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot record medication outcomes.")

    def perform_create(self, serializer):
        self._require_care_role()
        medication = serializer.validated_data["medication"]
        if not patients_for_user(self.request.user, self.request).filter(pk=medication.patient_id).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        serializer.save(status=DoseLog.Status.SCHEDULED)

    @action(detail=True, methods=["post"])
    def administer(self, request, pk=None):
        self._require_care_role()
        dose = self.get_object()
        serializer = AdministerDoseSerializer(data=request.data, context={"request": request, "dose": dose})
        serializer.is_valid(raise_exception=True)
        dose = serializer.save()
        return Response(self.get_serializer(dose).data)

    @action(detail=True, methods=["post"])
    def outcome(self, request, pk=None):
        self._require_care_role()
        dose = self.get_object()
        serializer = DoseOutcomeSerializer(data=request.data, context={"request": request, "dose": dose})
        serializer.is_valid(raise_exception=True)
        dose = serializer.save()
        return Response(self.get_serializer(dose).data)

    @action(detail=True, methods=["post"])
    def correct(self, request, pk=None):
        self._require_care_role()
        dose = self.get_object()
        serializer = CorrectDoseSerializer(data=request.data, context={"request": request, "dose": dose})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        dose.refresh_from_db()
        return Response(self.get_serializer(dose).data)


class MedicationInteractionViewSet(viewsets.ModelViewSet):
    serializer_class = MedicationInteractionSerializer
    permission_classes = [IsCareAdmin]

    def get_queryset(self):
        queryset = MedicationInteraction.objects.all()
        if self.request.user.is_superuser:
            return queryset
        active_org_id = get_active_organization_id(self.request.user, self.request)
        return queryset.filter(organization_id__in=[active_org_id, None])


class RefillRequestViewSet(viewsets.ModelViewSet):
    serializer_class = RefillRequestSerializer
    filterset_fields = ["medication", "status"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return RefillRequest.objects.filter(medication__patient_id__in=patient_ids).select_related(
            "medication", "requested_by", "resolved_by"
        )

    def perform_create(self, serializer):
        medication = serializer.validated_data["medication"]
        if not patients_for_user(self.request.user, self.request).filter(pk=medication.patient_id).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        refill = serializer.save(requested_by=self.request.user)
        record_audit(
            actor=self.request.user,
            patient=medication.patient,
            action="REFILL_REQUESTED",
            instance=refill,
            summary=f"Requested refill for {medication.name}",
        )

    def perform_update(self, serializer):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR}):
            raise PermissionDenied("A clinician or administrator must edit refill workflow records.")
        serializer.save()

    def perform_destroy(self, instance):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can delete refill workflow records.")
        instance.delete()

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        tenant_role = get_tenant_role(request.user, request)
        if not (request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot resolve refill requests.")
        refill = self.get_object()
        refill.status = request.data.get("status", RefillRequest.Status.RECEIVED)
        if refill.status not in RefillRequest.Status.values:
            return Response({"status": "Invalid refill status."}, status=status.HTTP_400_BAD_REQUEST)
        refill.resolved_by = request.user
        refill.resolved_at = timezone.now()
        refill.save(update_fields=["status", "resolved_by", "resolved_at", "updated_at"])
        return Response(self.get_serializer(refill).data)


class StockAdjustmentViewSet(viewsets.ModelViewSet):
    serializer_class = StockAdjustmentSerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["medication"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user, self.request).values_list("id", flat=True)
        return StockAdjustment.objects.filter(medication__patient_id__in=patient_ids).select_related("medication", "recorded_by")

    @transaction.atomic
    def perform_create(self, serializer):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot reconcile medication stock.")
        medication = Medication.objects.select_for_update().get(pk=serializer.validated_data["medication"].pk)
        if not patients_for_user(self.request.user, self.request).filter(pk=medication.patient_id).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        resulting = (medication.stock_quantity or 0) + serializer.validated_data["quantity_delta"]
        if resulting < 0:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"quantity_delta": "Stock cannot become negative."})
        medication.stock_quantity = resulting
        medication.save(update_fields=["stock_quantity", "updated_at"])
        adjustment = serializer.save(recorded_by=self.request.user, resulting_quantity=resulting)
        record_audit(
            actor=self.request.user,
            patient=medication.patient,
            action="MEDICATION_STOCK_ADJUSTED",
            instance=adjustment,
            summary=f"Adjusted stock for {medication.name}",
            metadata={"quantity_delta": adjustment.quantity_delta, "resulting_quantity": resulting},
        )
