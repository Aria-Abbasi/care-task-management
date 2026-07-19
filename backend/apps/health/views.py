from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.models import User
from apps.clinical.services import evaluate_vital_threshold
from apps.patients.access import patients_for_user
from apps.safety.services import record_audit

from .models import VitalRecord
from .serializers import VitalRecordSerializer


class VitalRecordViewSet(viewsets.ModelViewSet):
    serializer_class = VitalRecordSerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["patient", "type"]
    ordering_fields = ["recorded_at", "created_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        queryset = VitalRecord.objects.filter(patient_id__in=patient_ids).select_related("patient", "recorded_by")
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            queryset = queryset.filter(recorded_at__gte=start)
        if end:
            queryset = queryset.filter(recorded_at__lt=end)
        return queryset

    def create(self, request, *args, **kwargs):
        client_reference = request.data.get("client_reference")
        if client_reference:
            existing = self.get_queryset().filter(client_reference=client_reference).first()
            if existing:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        if not (self.request.user.is_superuser or self.request.user.role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot record clinical observations.")
        patient = serializer.validated_data["patient"]
        if not patients_for_user(self.request.user).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        reading = serializer.save(recorded_by=self.request.user)
        record_audit(
            actor=self.request.user,
            patient=patient,
            action="VITAL_RECORDED",
            instance=reading,
            summary=f"Recorded {reading.get_type_display()}",
            metadata={"source_system": "Haven", "recorded_at": reading.recorded_at.isoformat()},
            client_reference=reading.client_reference,
        )
        evaluate_vital_threshold(reading)
