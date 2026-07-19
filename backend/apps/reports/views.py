from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.models import User
from apps.patients.access import patients_for_user
from apps.safety.services import record_audit

from .models import ShiftReport
from .serializers import ShiftReportSerializer


class ShiftReportViewSet(viewsets.ModelViewSet):
    serializer_class = ShiftReportSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["patient", "author", "recipient", "status"]
    ordering_fields = ["shift_started_at", "shift_ended_at", "created_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return ShiftReport.objects.filter(patient_id__in=patient_ids).select_related("patient", "author", "recipient", "acknowledged_by")

    def create(self, request, *args, **kwargs):
        client_reference = request.data.get("client_reference")
        if client_reference:
            existing = self.get_queryset().filter(client_reference=client_reference).first()
            if existing:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        if not (self.request.user.is_superuser or self.request.user.role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot author clinical shift handovers.")
        patient = serializer.validated_data["patient"]
        if not patients_for_user(self.request.user).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        report = serializer.save(author=self.request.user)
        record_audit(
            actor=self.request.user,
            patient=patient,
            action="SHIFT_REPORT_CREATED",
            instance=report,
            summary="Created shift handover",
            client_reference=report.client_reference,
        )

    def perform_update(self, serializer):
        report = serializer.instance
        if report.author != self.request.user or report.status != ShiftReport.Status.DRAFT:
            raise PermissionDenied("Only the author can edit a draft handover.")
        serializer.save()

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        report = self.get_object()
        report.acknowledged_by = request.user
        report.acknowledged_at = timezone.now()
        report.save(update_fields=["acknowledged_by", "acknowledged_at", "updated_at"])
        record_audit(
            actor=request.user,
            patient=report.patient,
            action="SHIFT_REPORT_ACKNOWLEDGED",
            instance=report,
            summary="Acknowledged shift handover",
        )
        return Response(self.get_serializer(report).data)
