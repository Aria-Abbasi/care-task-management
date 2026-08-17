from django.http import FileResponse
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import User
from apps.patients.access import patients_for_user
from apps.safety.services import record_audit

from .models import (
    AdvanceDirective,
    Allergy,
    CarePlan,
    ClinicalDocument,
    Diagnosis,
    EmergencyContact,
    FoodIntakeLog,
    MealDefinition,
    VitalThreshold,
    WoundRecord,
)
from .serializers import (
    AdvanceDirectiveSerializer,
    AllergySerializer,
    CarePlanSerializer,
    ClinicalDocumentSerializer,
    DiagnosisSerializer,
    EmergencyContactSerializer,
    FoodIntakeLogSerializer,
    MealDefinitionSerializer,
    VitalThresholdSerializer,
    WoundRecordSerializer,
)


class PatientScopedViewSet(viewsets.ModelViewSet):
    patient_path = "patient"

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return self.queryset.filter(**{f"{self.patient_path}_id__in": patient_ids})

    def _validate_patient(self, patient):
        if not patients_for_user(self.request.user).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")

    def perform_create(self, serializer):
        patient = serializer.validated_data["patient"]
        self._validate_patient(patient)
        extra = {}
        for field in ["recorded_by", "uploaded_by", "author", "configured_by"]:
            if field in [item.name for item in serializer.Meta.model._meta.fields]:
                extra[field] = self.request.user
        instance = serializer.save(**extra)
        record_audit(
            actor=self.request.user,
            patient=patient,
            action=f"{instance.__class__.__name__.upper()}_CREATED",
            instance=instance,
            summary=f"Created {instance.__class__.__name__.lower()} record",
        )

    def perform_update(self, serializer):
        patient = serializer.validated_data.get("patient", serializer.instance.patient)
        self._validate_patient(patient)
        instance = serializer.save()
        record_audit(
            actor=self.request.user,
            patient=patient,
            action=f"{instance.__class__.__name__.upper()}_UPDATED",
            instance=instance,
            summary=f"Updated {instance.__class__.__name__.lower()} record",
        )


class ClinicalWriteRestrictedMixin:
    def _require_clinical_role(self):
        if not (self.request.user.is_superuser or self.request.user.role in {User.Role.ADMIN, User.Role.DOCTOR}):
            raise PermissionDenied("A clinician or administrator must change this record.")

    def perform_create(self, serializer):
        self._require_clinical_role()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_clinical_role()
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._require_clinical_role()
        super().perform_destroy(instance)


class CareTeamWriteRestrictedMixin:
    def _require_care_team_role(self):
        if not (self.request.user.is_superuser or self.request.user.role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts can review but cannot alter clinical records.")

    def perform_create(self, serializer):
        self._require_care_team_role()
        super().perform_create(serializer)

    def perform_update(self, serializer):
        self._require_care_team_role()
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self._require_care_team_role()
        super().perform_destroy(instance)


class AllergyViewSet(ClinicalWriteRestrictedMixin, PatientScopedViewSet):
    queryset = Allergy.objects.select_related("patient", "recorded_by")
    serializer_class = AllergySerializer
    filterset_fields = ["patient", "severity", "active"]


class DiagnosisViewSet(ClinicalWriteRestrictedMixin, PatientScopedViewSet):
    queryset = Diagnosis.objects.select_related("patient", "recorded_by")
    serializer_class = DiagnosisSerializer
    filterset_fields = ["patient", "status"]


class CarePlanViewSet(ClinicalWriteRestrictedMixin, PatientScopedViewSet):
    queryset = CarePlan.objects.select_related("patient", "author")
    serializer_class = CarePlanSerializer
    filterset_fields = ["patient", "status"]


class EmergencyContactViewSet(ClinicalWriteRestrictedMixin, PatientScopedViewSet):
    queryset = EmergencyContact.objects.select_related("patient")
    serializer_class = EmergencyContactSerializer
    filterset_fields = ["patient", "authorized_for_updates"]


class AdvanceDirectiveViewSet(ClinicalWriteRestrictedMixin, PatientScopedViewSet):
    queryset = AdvanceDirective.objects.select_related("patient", "recorded_by")
    serializer_class = AdvanceDirectiveSerializer
    filterset_fields = ["patient", "active"]

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        directive = self.get_object()
        if not directive.document:
            raise PermissionDenied("No directive document is attached.")
        record_audit(
            actor=request.user,
            patient=directive.patient,
            action="ADVANCE_DIRECTIVE_DOWNLOADED",
            instance=directive,
            summary="Downloaded advance directive",
        )
        return FileResponse(directive.document.open("rb"), as_attachment=True, filename=directive.document.name.rsplit("/", 1)[-1])


class ClinicalDocumentViewSet(CareTeamWriteRestrictedMixin, PatientScopedViewSet):
    queryset = ClinicalDocument.objects.select_related("patient", "uploaded_by")
    serializer_class = ClinicalDocumentSerializer
    filterset_fields = ["patient", "category"]

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        document = self.get_object()
        record_audit(
            actor=request.user,
            patient=document.patient,
            action="CLINICAL_DOCUMENT_DOWNLOADED",
            instance=document,
            summary=f"Downloaded clinical document: {document.title}",
        )
        return FileResponse(document.file.open("rb"), as_attachment=True, filename=document.file.name.rsplit("/", 1)[-1])


class WoundRecordViewSet(CareTeamWriteRestrictedMixin, PatientScopedViewSet):
    queryset = WoundRecord.objects.select_related("patient", "recorded_by")
    serializer_class = WoundRecordSerializer
    filterset_fields = ["patient", "location"]

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        wound = self.get_object()
        if not wound.photo:
            raise PermissionDenied("No wound photo is attached.")
        record_audit(
            actor=request.user,
            patient=wound.patient,
            action="WOUND_PHOTO_DOWNLOADED",
            instance=wound,
            summary="Downloaded wound-care photo",
        )
        return FileResponse(wound.photo.open("rb"), as_attachment=True, filename=wound.photo.name.rsplit("/", 1)[-1])


class VitalThresholdViewSet(ClinicalWriteRestrictedMixin, PatientScopedViewSet):
    queryset = VitalThreshold.objects.select_related("patient", "configured_by")
    serializer_class = VitalThresholdSerializer
    filterset_fields = ["patient", "vital_type", "active"]


class MealDefinitionViewSet(CareTeamWriteRestrictedMixin, PatientScopedViewSet):
    queryset = MealDefinition.objects.select_related("patient", "created_by")
    serializer_class = MealDefinitionSerializer
    filterset_fields = ["patient", "meal_type", "active"]
    ordering_fields = ["target_time", "name", "created_at"]


class FoodIntakeLogViewSet(PatientScopedViewSet):
    queryset = FoodIntakeLog.objects.select_related("patient", "meal_definition", "recorded_by")
    serializer_class = FoodIntakeLogSerializer
    filterset_fields = ["patient", "meal_type", "meal_definition"]
    ordering_fields = ["recorded_at", "created_at"]

    def perform_create(self, serializer):
        patient = serializer.validated_data["patient"]
        self._validate_patient(patient)
        log = serializer.save(recorded_by=self.request.user)
        record_audit(
            actor=self.request.user,
            patient=patient,
            action="FOOD_INTAKE_RECORDED",
            instance=log,
            summary=f"Recorded meal intake: {log.meal_name} ({log.portion_consumed}%)",
            metadata={"portion_consumed": log.portion_consumed, "meal_type": log.meal_type},
        )
