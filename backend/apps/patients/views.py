from datetime import datetime, time, timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.models import User
from apps.care_tasks.models import TaskOccurrence
from apps.care_tasks.serializers import TaskOccurrenceSerializer
from apps.care_tasks.services import generate_occurrences_for_date
from apps.common.permissions import IsCareAdmin
from apps.health.models import VitalRecord
from apps.health.serializers import VitalRecordSerializer
from apps.medications.models import DoseLog, Medication
from apps.medications.serializers import DoseLogSerializer, MedicationSerializer
from apps.medications.services import generate_dose_logs_for_date

from .access import patients_for_user
from .models import CareAssignment
from .serializers import CareAssignmentSerializer, PatientSerializer


class PatientViewSet(viewsets.ModelViewSet):
    serializer_class = PatientSerializer
    filterset_fields = ["active", "gender"]
    search_fields = ["first_name", "last_name", "room"]
    ordering_fields = ["first_name", "last_name", "birth_date", "created_at"]

    def get_queryset(self):
        return patients_for_user(self.request.user).prefetch_related("care_assignments")

    def _require_admin_for_write(self):
        user = self.request.user
        if not (user.is_superuser or user.role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can change patient profiles.")

    def perform_create(self, serializer):
        self._require_admin_for_write()
        if self.request.user.is_superuser:
            serializer.save()
        elif self.request.user.organization_id:
            serializer.save(organization=self.request.user.organization)
        else:
            raise PermissionDenied("An administrator must belong to an organization before creating patients.")

    def perform_update(self, serializer):
        self._require_admin_for_write()
        organization = serializer.validated_data.get("organization", serializer.instance.organization)
        if not self.request.user.is_superuser and organization != self.request.user.organization:
            raise PermissionDenied("Administrators cannot move patients outside their organization.")
        serializer.save()

    def perform_destroy(self, instance):
        self._require_admin_for_write()
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])

    @action(detail=True, methods=["get"])
    def dashboard(self, request, pk=None):
        patient = self.get_object()
        date_value = request.query_params.get("date")
        try:
            target_date = datetime.strptime(date_value, "%Y-%m-%d").date() if date_value else timezone.localdate()
        except ValueError:
            return Response({"date": "Use YYYY-MM-DD format."}, status=status.HTTP_400_BAD_REQUEST)

        zone = timezone.get_current_timezone()
        day_start = timezone.make_aware(datetime.combine(target_date, time.min), zone)
        day_end = day_start + timedelta(days=1)
        generate_occurrences_for_date(target_date)
        generate_dose_logs_for_date(target_date, patient=patient)
        occurrences = (
            TaskOccurrence.objects.filter(
                task__patient=patient,
                scheduled_at__gte=day_start,
                scheduled_at__lt=day_end,
            )
            .select_related("task", "completed_by")
            .prefetch_related("task__schedules")
        )
        counts = occurrences.aggregate(
            total=Count("id"),
            done=Count("id", filter=Q(status=TaskOccurrence.Status.DONE)),
            overdue=Count("id", filter=Q(status=TaskOccurrence.Status.MISSED)),
            pending=Count("id", filter=Q(status__in=[TaskOccurrence.Status.PENDING, TaskOccurrence.Status.DELAYED])),
        )
        latest_vitals = []
        for vital_type, _ in VitalRecord.Type.choices:
            record = patient.vital_records.filter(type=vital_type).first()
            if record:
                latest_vitals.append(record)

        medications = Medication.objects.filter(patient=patient, active=True).prefetch_related("schedules")
        dose_logs = (
            DoseLog.objects.filter(medication__patient=patient, scheduled_at__gte=day_start, scheduled_at__lt=day_end)
            .select_related("medication", "medication__patient", "administered_by")
            .prefetch_related("corrections", "corrections__corrected_by")
        )
        return Response(
            {
                "date": target_date,
                "patient": PatientSerializer(patient, context={"request": request}).data,
                "task_summary": counts,
                "occurrences": TaskOccurrenceSerializer(occurrences, many=True, context={"request": request}).data,
                "latest_vitals": VitalRecordSerializer(latest_vitals, many=True).data,
                "medications": MedicationSerializer(medications, many=True, context={"request": request}).data,
                "dose_logs": DoseLogSerializer(dose_logs, many=True, context={"request": request}).data,
            }
        )


class CareAssignmentViewSet(viewsets.ModelViewSet):
    serializer_class = CareAssignmentSerializer
    filterset_fields = ["patient", "user", "relationship", "active"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user).values_list("id", flat=True)
        return CareAssignment.objects.filter(patient_id__in=patient_ids).select_related("user", "patient")

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [IsCareAdmin()]
        return [permissions.IsAuthenticated()]

    def _validate_organization(self, serializer):
        patient = serializer.validated_data.get("patient", serializer.instance.patient if serializer.instance else None)
        user = serializer.validated_data.get("user", serializer.instance.user if serializer.instance else None)
        if patient and user and patient.organization_id != user.organization_id:
            raise PermissionDenied("Care assignments cannot cross organization boundaries.")

    def perform_create(self, serializer):
        self._validate_organization(serializer)
        serializer.save()

    def perform_update(self, serializer):
        self._validate_organization(serializer)
        serializer.save()
