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
from apps.patients.models import Patient
from apps.safety.services import record_audit

from .models import CareTaskTemplate, CompletionLog, Task, TaskOccurrence
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
        return patients_for_user(self.request.user, self.request).values_list("id", flat=True)

    def validate_patient_access(self, patient):
        if not patients_for_user(self.request.user, self.request).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")

    def require_care_role(self):
        if not (self.request.user.is_superuser or self.request.user.role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts can review care but cannot record or change clinical care.")


class TaskViewSet(PatientAccessMixin, viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    filterset_fields = ["patient", "category", "priority", "schedule_type", "assigned_to", "active"]
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
        if task.schedule_type == Task.ScheduleType.SCHEDULED:
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

    @action(detail=True, methods=["post"], url_path="log-action")
    def log_action(self, request, pk=None):
        task = self.get_object()
        self.validate_patient_access(task.patient)
        if request.user.role == User.Role.FAMILY:
            if not getattr(task.patient.organization, "allow_family_task_completion", False):
                raise PermissionDenied("Family task completion is disabled for this organization.")

        note = request.data.get("note", "")
        photo = request.FILES.get("photo")
        client_reference = request.data.get("client_reference")
        outcome = request.data.get("outcome", CompletionLog.Outcome.COMPLETED)
        now = timezone.now()

        with transaction.atomic():
            occurrence = TaskOccurrence.objects.create(
                task=task,
                scheduled_at=now,
                status=TaskOccurrence.Status.DONE,
                completed_at=now,
                completed_by=request.user,
                outcome=outcome,
                version=1,
            )
            CompletionLog.objects.create(
                occurrence=occurrence,
                completed_by=request.user,
                outcome=outcome,
                note=note,
                photo=photo,
                client_reference=client_reference,
            )
            record_audit(
                actor=request.user,
                patient=task.patient,
                action="TASK_ON_DEMAND_LOGGED",
                instance=occurrence,
                summary=f"Logged on-demand task: {task.title}",
                metadata={"note": note, "outcome": outcome},
                client_reference=client_reference,
            )
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="suggested-quick-actions")
    def suggested_quick_actions(self, request):
        patient_id = request.query_params.get("patient")
        if not patient_id:
            return Response({"patient": ["This query parameter is required."]}, status=status.HTTP_400_BAD_REQUEST)
        patient = Patient.objects.filter(pk=patient_id).first()
        if not patient:
            return Response({"patient": ["Patient not found."]}, status=status.HTTP_404_NOT_FOUND)
        self.validate_patient_access(patient)

        hour_param = request.query_params.get("hour")
        target_hour = int(hour_param) if hour_param and hour_param.isdigit() else None

        from .services import get_suggested_quick_actions

        data = get_suggested_quick_actions(patient, target_hour=target_hour)
        return Response(data, status=status.HTTP_200_OK)


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
            .select_related("task", "task__patient", "task__assigned_to", "completed_by", "schedule", "completion", "completion__completed_by")
            .prefetch_related("task__schedules", "corrections", "corrections__corrected_by")
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

    @action(detail=False, methods=["post"], url_path="ad-hoc")
    def create_ad_hoc(self, request):
        self.require_care_role()
        patient_id = request.data.get("patient")
        if not patient_id:
            return Response({"patient": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        patient = Patient.objects.filter(pk=patient_id).first()
        if not patient:
            return Response({"patient": ["Patient not found."]}, status=status.HTTP_404_NOT_FOUND)
        self.validate_patient_access(patient)

        title = request.data.get("title")
        if not title:
            return Response({"title": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)

        category = request.data.get("category", Task.Category.PERSONAL_CARE)
        priority = request.data.get("priority", Task.Priority.NORMAL)
        instructions = request.data.get("instructions", "")
        note = request.data.get("note", "")
        photo = request.FILES.get("photo")
        client_reference = request.data.get("client_reference")
        outcome = request.data.get("outcome", CompletionLog.Outcome.COMPLETED)

        now = timezone.now()
        with transaction.atomic():
            task = Task.objects.create(
                patient=patient,
                title=title,
                category=category,
                priority=priority,
                schedule_type=Task.ScheduleType.ON_DEMAND,
                instructions=instructions,
                assigned_to=request.user if request.user.role == User.Role.CAREGIVER else None,
                active=True,
            )
            occurrence = TaskOccurrence.objects.create(
                task=task,
                scheduled_at=now,
                status=TaskOccurrence.Status.DONE,
                completed_at=now,
                completed_by=request.user,
                outcome=outcome,
                version=1,
            )
            CompletionLog.objects.create(
                occurrence=occurrence,
                completed_by=request.user,
                outcome=outcome,
                note=note,
                photo=photo,
                client_reference=client_reference,
            )
            record_audit(
                actor=request.user,
                patient=patient,
                action="TASK_AD_HOC_CREATED",
                instance=occurrence,
                summary=f"Created and logged ad-hoc task: {title}",
                metadata={"note": note, "category": category},
                client_reference=client_reference,
            )
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        occurrence = self.get_object()
        if request.user.role == User.Role.FAMILY:
            if not getattr(occurrence.task.patient.organization, "allow_family_task_completion", False):
                raise PermissionDenied("Family task completion is disabled for this organization.")
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
