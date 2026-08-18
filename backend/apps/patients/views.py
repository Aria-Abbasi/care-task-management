from datetime import datetime, time, timedelta

from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.models import User
from apps.care_tasks.models import TaskOccurrence
from apps.care_tasks.serializers import TaskOccurrenceSerializer
from apps.care_tasks.services import generate_occurrences_for_date
from apps.common.permissions import IsCareAdmin
from apps.common.timezones import patient_timezone
from apps.communications.models import CaregiverAvailability, ShiftAssignment
from apps.communications.serializers import CaregiverAvailabilitySerializer, ShiftAssignmentSerializer
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
        return patients_for_user(self.request.user, self.request).prefetch_related("care_assignments")

    def _require_admin_for_write(self):
        user = self.request.user
        if not (user.is_superuser or user.role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can change patient profiles.")

    def perform_create(self, serializer):
        self._require_admin_for_write()
        if self.request.user.is_superuser:
            if not serializer.validated_data.get("organization"):
                raise ValidationError({"organization": "Choose the organization that owns this patient."})
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
            zone = patient_timezone(patient)
            target_date = datetime.strptime(date_value, "%Y-%m-%d").date() if date_value else timezone.localdate(timezone=zone)
        except ValueError:
            return Response({"date": "Use YYYY-MM-DD format."}, status=status.HTTP_400_BAD_REQUEST)

        day_start = timezone.make_aware(datetime.combine(target_date, time.min), zone)
        day_end = day_start + timedelta(days=1)
        generate_occurrences_for_date(target_date, patient=patient)
        generate_dose_logs_for_date(target_date, patient=patient)
        occurrences = (
            TaskOccurrence.objects.filter(
                task__patient=patient,
                scheduled_at__gte=day_start,
                scheduled_at__lt=day_end,
            )
            .select_related("task", "task__assigned_to", "completed_by", "schedule", "completion", "completion__completed_by")
            .prefetch_related("task__schedules", "corrections", "corrections__corrected_by")
        )
        counts = occurrences.aggregate(
            total=Count("id"),
            done=Count("id", filter=Q(status=TaskOccurrence.Status.DONE)),
            overdue=Count("id", filter=Q(status=TaskOccurrence.Status.MISSED)),
            pending=Count("id", filter=Q(status__in=[TaskOccurrence.Status.PENDING, TaskOccurrence.Status.DELAYED])),
        )
        latest_vitals_dict = {}
        for record in patient.vital_records.select_related("recorded_by").order_by("-recorded_at"):
            if record.type not in latest_vitals_dict:
                latest_vitals_dict[record.type] = record
        latest_vitals = list(latest_vitals_dict.values())

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

    @action(detail=True, methods=["get"])
    def calendar(self, request, pk=None):
        """Return a bounded ISO-date range of care events and coverage data."""
        patient = self.get_object()
        start_value = request.query_params.get("start")
        end_value = request.query_params.get("end")
        if not start_value or not end_value:
            return Response({"detail": "Provide start and end dates in YYYY-MM-DD format."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            start_date = datetime.strptime(start_value, "%Y-%m-%d").date()
            end_date = datetime.strptime(end_value, "%Y-%m-%d").date()
        except ValueError:
            return Response({"detail": "Use YYYY-MM-DD format."}, status=status.HTTP_400_BAD_REQUEST)
        if end_date <= start_date or (end_date - start_date).days > 42:
            return Response({"detail": "Calendar ranges must be between 1 and 42 days."}, status=status.HTTP_400_BAD_REQUEST)

        for offset in range((end_date - start_date).days):
            generate_occurrences_for_date(start_date + timedelta(days=offset), patient=patient)

        zone = patient_timezone(patient)
        range_start = timezone.make_aware(datetime.combine(start_date, time.min), zone)
        range_end = timezone.make_aware(datetime.combine(end_date, time.min), zone)
        occurrences = (
            TaskOccurrence.objects.filter(task__patient=patient, scheduled_at__gte=range_start, scheduled_at__lt=range_end)
            .select_related("task", "completed_by", "schedule")
            .prefetch_related("task__schedules")
        )
        shifts = ShiftAssignment.objects.filter(patient=patient, starts_at__lt=range_end, ends_at__gt=range_start).select_related(
            "patient", "caregiver"
        )
        assignments = CareAssignment.objects.filter(patient=patient, active=True).select_related("user", "patient")
        availability = CaregiverAvailability.objects.filter(
            caregiver_id__in=assignments.values_list("user_id", flat=True), starts_at__lt=range_end, ends_at__gt=range_start
        ).select_related("caregiver")
        return Response(
            {
                "start": start_value,
                "end": end_value,
                "occurrences": TaskOccurrenceSerializer(occurrences, many=True, context={"request": request}).data,
                "shifts": ShiftAssignmentSerializer(shifts, many=True, context={"request": request}).data,
                "availability": CaregiverAvailabilitySerializer(availability, many=True, context={"request": request}).data,
                "assignments": CareAssignmentSerializer(assignments, many=True, context={"request": request}).data,
            }
        )

    @action(detail=True, methods=["get"], url_path="suggested-actions")
    def suggested_actions(self, request, pk=None):
        patient = self.get_object()
        hour_param = request.query_params.get("hour")
        target_hour = int(hour_param) if hour_param and hour_param.isdigit() else None
        from apps.care_tasks.services import get_suggested_quick_actions

        data = get_suggested_quick_actions(patient, target_hour=target_hour)
        return Response(data, status=status.HTTP_200_OK)


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
