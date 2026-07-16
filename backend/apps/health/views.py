from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.patients.access import patients_for_user

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
        patient = serializer.validated_data["patient"]
        if not patients_for_user(self.request.user).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        serializer.save(recorded_by=self.request.user)
