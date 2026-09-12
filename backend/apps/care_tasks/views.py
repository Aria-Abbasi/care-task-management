from django.db import transaction
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.context import get_active_organization_id, get_tenant_role
from apps.accounts.models import Organization, User
from apps.common.exceptions import VersionConflict
from apps.common.permissions import IsCareAdmin
from apps.common.timezones import patient_timezone
from apps.patients.access import patients_for_user
from apps.patients.models import Patient
from apps.safety.services import record_audit

from .models import AdHocTemplate, CareTaskTemplate, CompletionLog, Task, TaskOccurrence
from .serializers import (
    AdHocTemplateSerializer,
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
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts can review care but cannot record or change clinical care.")

    def require_supervisor_or_admin(self):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR}):
            raise PermissionDenied("Only administrators and clinicians can manage care templates.")


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
        tenant_role = get_tenant_role(request.user, request)
        if tenant_role == User.Role.FAMILY:
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

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [IsCareAdmin()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = CareTaskTemplate.objects.select_related("organization")
        if self.request.user.is_superuser:
            return queryset
        active_org_id = get_active_organization_id(self.request.user, self.request)
        if active_org_id:
            return queryset.filter(organization_id=active_org_id)
        return queryset.filter(organization_id=self.request.user.organization_id)

    def perform_create(self, serializer):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can create task templates.")
        active_org_id = get_active_organization_id(self.request.user, self.request)
        if active_org_id:
            organization = Organization.objects.get(pk=active_org_id)
        else:
            organization = self.request.user.organization
        if not organization:
            raise PermissionDenied("Assign this account to an organization first.")
        serializer.save(organization=organization)

    def perform_update(self, serializer):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can edit task templates.")
        serializer.save()

    def perform_destroy(self, instance):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role == User.Role.ADMIN):
            raise PermissionDenied("Only administrators can archive task templates.")
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])


def perform_quick_log(template, patient, user, request, client_reference=None, note="", performed_at=None):
    if client_reference:
        existing_log = CompletionLog.objects.filter(client_reference=client_reference).select_related("occurrence").first()
        if existing_log:
            return existing_log.occurrence, False

    tenant_role = get_tenant_role(user, request)
    if tenant_role == User.Role.FAMILY:
        if not getattr(patient.organization, "allow_family_task_completion", False):
            raise PermissionDenied("Family task completion is disabled for this organization.")

    now = performed_at or timezone.now()
    final_note = note if note else template.default_note

    with transaction.atomic():
        # Canonical task de-duplication: fetch or create a single ON_DEMAND task for this patient and title
        task, _ = Task.objects.get_or_create(
            patient=patient,
            title=template.title,
            schedule_type=Task.ScheduleType.ON_DEMAND,
            defaults={
                "category": template.category,
                "priority": Task.Priority.NORMAL,
                "instructions": template.default_note,
                "assigned_to": user if tenant_role == User.Role.CAREGIVER else None,
                "active": True,
            },
        )
        if not task.active:
            task.active = True
            task.save(update_fields=["active", "updated_at"])

        occurrence = TaskOccurrence.objects.create(
            task=task,
            ad_hoc_template=template,
            scheduled_at=now,
            status=TaskOccurrence.Status.DONE,
            completed_at=now,
            completed_by=user,
            outcome=CompletionLog.Outcome.COMPLETED,
            version=1,
        )
        CompletionLog.objects.create(
            occurrence=occurrence,
            completed_by=user,
            outcome=CompletionLog.Outcome.COMPLETED,
            note=final_note,
            client_reference=client_reference,
        )
        record_audit(
            actor=user,
            patient=patient,
            action="TASK_ON_DEMAND_LOGGED",
            instance=occurrence,
            summary=f"Quick logged care action: {template.title}",
            metadata={"note": final_note, "outcome": CompletionLog.Outcome.COMPLETED, "template_id": template.id},
            client_reference=client_reference,
        )
    return occurrence, True


class AdHocTemplateViewSet(PatientAccessMixin, viewsets.ModelViewSet):
    serializer_class = AdHocTemplateSerializer
    filterset_fields = ["category", "is_quick_action", "active"]
    search_fields = ["title", "default_note"]
    ordering_fields = ["sort_order", "title", "created_at"]

    def get_queryset(self):
        queryset = AdHocTemplate.objects.filter(active=True).select_related("organization", "patient")
        if not self.request.user.is_superuser:
            active_org_id = get_active_organization_id(self.request.user, self.request) or self.request.user.organization_id
            if active_org_id:
                queryset = queryset.filter(organization_id=active_org_id)
            else:
                return queryset.none()

        patient_param = self.request.query_params.get("patient")
        if patient_param:
            try:
                patient = Patient.objects.get(pk=patient_param)
                self.validate_patient_access(patient)
                queryset = queryset.filter(Q(patient=patient) | Q(patient__isnull=True))
            except (Patient.DoesNotExist, ValueError):
                return queryset.none()
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        patient_param = self.request.query_params.get("patient")
        if patient_param:
            context["patient_id"] = patient_param
        return context

    def perform_create(self, serializer):
        self.require_supervisor_or_admin()
        patient = serializer.validated_data.get("patient")
        if patient:
            self.validate_patient_access(patient)
            organization = patient.organization
        else:
            active_org_id = get_active_organization_id(self.request.user, self.request) or self.request.user.organization_id
            if not active_org_id:
                raise PermissionDenied("User is not associated with an organization.")
            organization = Organization.objects.get(pk=active_org_id)
        template = serializer.save(organization=organization)
        record_audit(
            actor=self.request.user,
            patient=template.patient,
            action="ADHOC_TEMPLATE_CREATED",
            instance=template,
            summary=f"Created ad-hoc template: {template.title}",
        )

    def perform_update(self, serializer):
        self.require_supervisor_or_admin()
        patient = serializer.validated_data.get("patient", serializer.instance.patient)
        if patient:
            self.validate_patient_access(patient)
        template = serializer.save()
        record_audit(
            actor=self.request.user,
            patient=template.patient,
            action="ADHOC_TEMPLATE_UPDATED",
            instance=template,
            summary=f"Updated ad-hoc template: {template.title}",
        )

    def perform_destroy(self, instance):
        self.require_supervisor_or_admin()
        instance.active = False
        instance.save(update_fields=["active", "updated_at"])
        record_audit(
            actor=self.request.user,
            patient=instance.patient,
            action="ADHOC_TEMPLATE_DEACTIVATED",
            instance=instance,
            summary=f"Deactivated ad-hoc template: {instance.title}",
        )

    @action(detail=True, methods=["post"], url_path="log")
    def log(self, request, pk=None):
        template = self.get_object()
        patient_id = request.data.get("patient") or request.data.get("patient_id")
        if not patient_id:
            return Response({"patient": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            patient = Patient.objects.get(pk=patient_id)
        except (Patient.DoesNotExist, ValueError):
            return Response({"patient": ["Patient not found."]}, status=status.HTTP_404_NOT_FOUND)
        self.validate_patient_access(patient)

        client_reference = request.data.get("client_reference")
        note = request.data.get("note", "")
        performed_at = request.data.get("performed_at")

        occurrence, was_created = perform_quick_log(
            template=template,
            patient=patient,
            user=request.user,
            request=request,
            client_reference=client_reference,
            note=note,
            performed_at=performed_at,
        )
        return Response(
            TaskOccurrenceSerializer(occurrence, context={"request": request}).data,
            status=status.HTTP_201_CREATED if was_created else status.HTTP_200_OK,
        )


class TaskOccurrenceViewSet(PatientAccessMixin, viewsets.ModelViewSet):
    serializer_class = TaskOccurrenceSerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["task", "task__patient", "status"]
    ordering_fields = ["scheduled_at", "completed_at", "created_at"]

    def get_queryset(self):
        queryset = (
            TaskOccurrence.objects.filter(task__patient_id__in=self.allowed_patient_ids())
            .select_related(
                "task", "task__patient", "task__assigned_to", "completed_by", "schedule", "completion", "completion__completed_by"
            )
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
        tenant_role = get_tenant_role(request.user, request)
        with transaction.atomic():
            task = Task.objects.create(
                patient=patient,
                title=title,
                category=category,
                priority=priority,
                schedule_type=Task.ScheduleType.ON_DEMAND,
                instructions=instructions,
                assigned_to=request.user if tenant_role == User.Role.CAREGIVER else None,
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
        tenant_role = get_tenant_role(request.user, request)
        if tenant_role == User.Role.FAMILY:
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

    @action(detail=False, methods=["post"], url_path="quick-log")
    def quick_log(self, request):
        template_id = request.data.get("template_id") or request.data.get("template")
        if not template_id:
            return Response({"template_id": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        template = AdHocTemplate.objects.filter(pk=template_id, active=True).first()
        if not template:
            return Response({"template_id": ["Template not found."]}, status=status.HTTP_404_NOT_FOUND)

        patient_id = request.data.get("patient") or request.data.get("patient_id")
        if not patient_id:
            return Response({"patient": ["This field is required."]}, status=status.HTTP_400_BAD_REQUEST)
        try:
            patient = Patient.objects.get(pk=patient_id)
        except (Patient.DoesNotExist, ValueError):
            return Response({"patient": ["Patient not found."]}, status=status.HTTP_404_NOT_FOUND)
        self.validate_patient_access(patient)

        client_reference = request.data.get("client_reference")
        note = request.data.get("note", "")
        performed_at = request.data.get("performed_at")

        occurrence, was_created = perform_quick_log(
            template=template,
            patient=patient,
            user=request.user,
            request=request,
            client_reference=client_reference,
            note=note,
            performed_at=performed_at,
        )
        return Response(
            TaskOccurrenceSerializer(occurrence, context={"request": request}).data,
            status=status.HTTP_201_CREATED if was_created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="undo")
    def undo(self, request, pk=None):
        occurrence = self.get_object()
        tenant_role = get_tenant_role(request.user, request)
        is_supervisor = request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR}
        if occurrence.completed_by_id != request.user.id and not is_supervisor:
            raise PermissionDenied("You can only undo care actions that you recorded.")

        if occurrence.status != TaskOccurrence.Status.DONE:
            return Response({"detail": "Only completed occurrences can be undone."}, status=status.HTTP_400_BAD_REQUEST)

        # Bounded undo window (grace window of 300 seconds)
        if occurrence.completed_at and (timezone.now() - occurrence.completed_at).total_seconds() > 300:
            return Response(
                {"detail": "This action can no longer be undone. The undo window has expired."}, status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            occurrence.status = TaskOccurrence.Status.SKIPPED
            occurrence.outcome = "REFUSED"
            occurrence.version += 1
            occurrence.save(update_fields=["status", "outcome", "version", "updated_at"])

            completion = getattr(occurrence, "completion", None)
            if completion:
                completion.outcome = CompletionLog.Outcome.REFUSED
                completion.note = f"{completion.note} [Undone by {request.user.display_name} within grace window]".strip()
                completion.save(update_fields=["outcome", "note", "updated_at"])

            record_audit(
                actor=request.user,
                patient=occurrence.task.patient,
                action="TASK_QUICK_LOG_UNDONE",
                instance=occurrence,
                summary=f"Undid quick-log: {occurrence.task.title}",
                metadata={"reason": "Undone by caregiver within grace window", "previous_status": "DONE"},
            )

        return Response(TaskOccurrenceSerializer(occurrence, context={"request": request}).data, status=status.HTTP_200_OK)
