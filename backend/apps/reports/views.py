from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied

from apps.patients.access import patients_for_user

from .models import ShiftReport
from .serializers import ShiftReportSerializer


class ShiftReportViewSet(viewsets.ModelViewSet):
    serializer_class = ShiftReportSerializer
    filterset_fields = ["patient", "author", "recipient", "status"]
    ordering_fields = ["shift_started_at", "shift_ended_at", "created_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return ShiftReport.objects.filter(patient_id__in=patient_ids).select_related("patient", "author", "recipient")

    def perform_create(self, serializer):
        patient = serializer.validated_data["patient"]
        if not patients_for_user(self.request.user).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        serializer.save(author=self.request.user)
