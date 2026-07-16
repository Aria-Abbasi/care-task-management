from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.patients.access import patients_for_user

from .models import Task, TaskOccurrence
from .serializers import (
    CompleteOccurrenceSerializer,
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
        self.validate_patient_access(serializer.validated_data["patient"])
        serializer.save()
        generate_occurrences_for_date(timezone.localdate())

    def perform_update(self, serializer):
        self.validate_patient_access(serializer.validated_data.get("patient", serializer.instance.patient))
        serializer.save()

    def perform_destroy(self, instance):
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
        task = serializer.validated_data["task"]
        self.validate_patient_access(task.patient)
        serializer.save()

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        occurrence = self.get_object()
        serializer = CompleteOccurrenceSerializer(data=request.data, context={"request": request, "occurrence": occurrence})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        occurrence.refresh_from_db()
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def delay(self, request, pk=None):
        occurrence = self.get_object()
        serializer = DelayOccurrenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        occurrence.delayed_until = serializer.validated_data["delayed_until"]
        occurrence.status = TaskOccurrence.Status.DELAYED
        occurrence.save(update_fields=["delayed_until", "status", "updated_at"])
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def skip(self, request, pk=None):
        occurrence = self.get_object()
        if occurrence.status == TaskOccurrence.Status.DONE:
            return Response({"detail": "A completed task cannot be skipped."}, status=status.HTTP_409_CONFLICT)
        occurrence.status = TaskOccurrence.Status.SKIPPED
        occurrence.save(update_fields=["status", "updated_at"])
        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data)
