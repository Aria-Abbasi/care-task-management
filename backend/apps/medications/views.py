from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.patients.access import patients_for_user

from .models import DoseLog, Medication
from .serializers import DoseLogSerializer, MedicationSerializer


class MedicationViewSet(viewsets.ModelViewSet):
    serializer_class = MedicationSerializer
    filterset_fields = ["patient", "active"]
    search_fields = ["name", "instructions"]
    ordering_fields = ["name", "created_at", "stock_quantity"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return Medication.objects.filter(patient_id__in=patient_ids).select_related("patient").prefetch_related("schedules")

    def _validate_patient(self, patient):
        if not patients_for_user(self.request.user).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")

    def perform_create(self, serializer):
        self._validate_patient(serializer.validated_data["patient"])
        serializer.save()

    def perform_update(self, serializer):
        self._validate_patient(serializer.validated_data.get("patient", serializer.instance.patient))
        serializer.save()

    def perform_destroy(self, instance):
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])


class DoseLogViewSet(viewsets.ModelViewSet):
    serializer_class = DoseLogSerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["medication", "medication__patient", "status"]
    ordering_fields = ["scheduled_at", "administered_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return DoseLog.objects.filter(medication__patient_id__in=patient_ids).select_related("medication", "administered_by")

    def perform_create(self, serializer):
        medication = serializer.validated_data["medication"]
        if not patients_for_user(self.request.user).filter(pk=medication.patient_id).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        status_value = serializer.validated_data.get("status", DoseLog.Status.SCHEDULED)
        administered = status_value == DoseLog.Status.GIVEN
        serializer.save(
            administered_by=self.request.user if administered else None,
            administered_at=timezone.now() if administered else None,
        )

    @action(detail=True, methods=["post"])
    def administer(self, request, pk=None):
        dose = self.get_object()
        if dose.status == DoseLog.Status.GIVEN:
            return Response({"detail": "This dose has already been administered."}, status=status.HTTP_409_CONFLICT)
        dose.status = DoseLog.Status.GIVEN
        dose.administered_at = timezone.now()
        dose.administered_by = request.user
        dose.note = request.data.get("note", dose.note)
        dose.save(update_fields=["status", "administered_at", "administered_by", "note", "updated_at"])
        return Response(self.get_serializer(dose).data)
