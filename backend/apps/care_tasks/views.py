from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.models import User
from apps.common.exceptions import VersionConflict
from apps.common.timezones import patient_timezone
from apps.patients.access import patients_for_user
from apps.safety.services import record_audit

from .models import CareTaskTemplate, Task, TaskOccurrence
from .serializers import (
    CareTaskTemplateSerializer,
    CompleteOccurrenceSerializer,
    CorrectOccurrenceSerializer,
    DelayOccurrenceSerializer,
    TaskOccurrenceSerializer,
    TaskSerializer,
)
from .services import generate_occurrences_for_date


class PatientAccessMixin:
    def allowed_patient_ids(self):
        return patients_for_user(self.request.user).values_list("id", flat=True)

    def validate_patient_access(self, patient):
        if not patients_for_user(self.request.user).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")

    def require_care_role(self):
        if not (self.request.user.is_superuser or self.request.user.role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts can review care but cannot record or change clinical care.")


class TaskViewSet(PatientAccessMixin, viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    filterset_fields = ["patient", "category", "priority", "assigned_to", "active"]
    search_fields = ["title", "instructions"]
    ordering_fields = ["title", "priority", "created_at"]

    def get_queryset(self):
        return (
            Task.objects.filter(patient_id__in=self.allowed_patient_ids())
            .select_related("patient", "assigned_to")
            .prefetch_related("schedules")
        )

    def create(self, request, *args, **kwargs):
        client_reference = request.data.get("client_reference")
        if client_reference:
            existing = self.get_queryset().filter(client_reference=client_reference).first()
            if existing:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        self.require_care_role()
        self.validate_patient_access(serializer.validated_data["patient"])
        task = serializer.save()
        generate_occurrences_for_date(timezone.localdate(timezone=patient_timezone(task.patient)), patient=task.patient)
        record_audit(
            actor=self.request.user,
            patient=task.patient,
            action="TASK_CREATED",
            instance=task,
            summary=f"Created care task: {task.title}",
            client_reference=task.client_reference,
        )

    def perform_update(self, serializer):
        self.require_care_role()
        self.validate_patient_access(serializer.validated_data.get("patient", serializer.instance.patient))
        task = serializer.save()
        record_audit(
            actor=self.request.user,
            patient=task.patient,
            action="TASK_UPDATED",
            instance=task,
            summary=f"Updated care task: {task.title}",
        )

    def perform_destroy(self, instance):
        self.require_care_role()
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])
        record_audit(
            actor=self.request.user,
            patient=instance.patient,
            action="TASK_DEACTIVATED",
            instance=instance,
            summary=f"Deactivated care task: {instance.title}",
        )


class CareTaskTemplateViewSet(viewsets.ModelViewSet):
    serializer_class = CareTaskTemplateSerializer
    filterset_fields = ["active", "category"]
    search_fields = ["name", "title", "instructions"]
    ordering_fields = ["name", "created_at"]

    def get_queryset(self):
        queryset = CareTaskTemplate.objects.select_related("organization")
        if self.request.user.is_superuser:
            return queryset
        return queryset.filter(organization_id=self.request.user.organization_id)

    def perform_create(self, serializer):
        if not (self.request.user.is_superuser or self.request.user.role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can create task templates.")
        organization = self.request.user.organization
        if not organization:
            raise PermissionDenied("Assign this account to an organization first.")
        serializer.save(organization=organization)

    def perform_update(self, serializer):
        if not (self.request.user.is_superuser or self.request.user.role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can edit task templates.")
        serializer.save()

    def perform_destroy(self, instance):
        if not (self.request.user.is_superuser or self.request.user.role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can archive task templates.")
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])


class TaskOccurrenceViewSet(PatientAccessMixin, viewsets.ModelViewSet):
    serializer_class = TaskOccurrenceSerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["task", "task__patient", "status"]
    ordering_fields = ["scheduled_at", "completed_at", "created_at"]

    def get_queryset(self):
        queryset = (
            TaskOccurrence.objects.filter(task__patient_id__in=self.allowed_patient_ids())
            .select_related("task", "task__patient", "completed_by", "schedule")
            .prefetch_related("task__schedules")
        )
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            queryset = queryset.filter(scheduled_at__gte=start)
        if end:
            queryset = queryset.filter(scheduled_at__lt=end)
        return queryset

    def perform_create(self, serializer):
        self.require_care_role()
        task = serializer.validated_data["task"]
        self.validate_patient_access(task.patient)
        serializer.save()

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        self.require_care_role()
        occurrence = self.get_object()
        serializer = CompleteOccurrenceSerializer(data=request.data, context={"request": request, "occurrence": occurrence})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        occurrence.refresh_from_db()
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="completion-photo")
    def completion_photo(self, request, pk=None):
        occurrence = self.get_object()
        completion = getattr(occurrence, "completion", None)
        if not completion or not completion.photo:
            raise PermissionDenied("No completion photo is attached.")
        record_audit(
            actor=request.user,
            patient=occurrence.task.patient,
            action="TASK_COMPLETION_PHOTO_DOWNLOADED",
            instance=occurrence,
            summary=f"Downloaded completion photo for {occurrence.task.title}",
        )
        return FileResponse(completion.photo.open("rb"), as_attachment=True, filename=completion.photo.name.rsplit("/", 1)[-1])

    @action(detail=True, methods=["post"])
    def correct(self, request, pk=None):
        self.require_care_role()
        occurrence = self.get_object()
        serializer = CorrectOccurrenceSerializer(data=request.data, context={"request": request, "occurrence": occurrence})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        occurrence.refresh_from_db()
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def delay(self, request, pk=None):
        self.require_care_role()
        occurrence = self.get_object()
        serializer = DelayOccurrenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            occurrence = TaskOccurrence.objects.select_for_update().select_related("task", "task__patient").get(pk=occurrence.pk)
            if serializer.validated_data["expected_version"] != occurrence.version:
                raise VersionConflict(
                    {"id": occurrence.id, "status": occurrence.status, "outcome": occurrence.outcome, "version": occurrence.version}
                )
            occurrence.delayed_until = serializer.validated_data["delayed_until"]
            occurrence.status = TaskOccurrence.Status.DELAYED
            occurrence.version += 1
            occurrence.save(update_fields=["delayed_until", "status", "version", "updated_at"])
            record_audit(
                actor=request.user,
                patient=occurrence.task.patient,
                action="TASK_DELAYED",
                instance=occurrence,
                summary=f"Delayed {occurrence.task.title}",
                metadata={"reason": serializer.validated_data["reason"], "delayed_until": occurrence.delayed_until.isoformat()},
            )
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def skip(self, request, pk=None):
        self.require_care_role()
        occurrence = self.get_object()
        serializer = CompleteOccurrenceSerializer(data=request.data, context={"request": request, "occurrence": occurrence})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        occurrence.refresh_from_db()
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data)
