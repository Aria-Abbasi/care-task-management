from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.common.exceptions import VersionConflict
from apps.patients.models import CareAssignment
from apps.safety.services import record_audit, resolve_source_alerts

from .models import CareTaskTemplate, CompletionCorrection, CompletionLog, Task, TaskOccurrence, TaskSchedule


def occurrence_state(occurrence):
    return {
        "id": occurrence.id,
        "status": occurrence.status,
        "outcome": occurrence.outcome,
        "version": occurrence.version,
        "updated_at": occurrence.updated_at.isoformat(),
    }


class TaskScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskSchedule
        fields = [
            "id",
            "frequency",
            "time",
            "specific_date",
            "interval_hours",
            "days_of_week",
            "event_reference",
            "window_before_minutes",
            "window_after_minutes",
            "starts_on",
            "ends_on",
        ]
        read_only_fields = ["id"]

    def validate_days_of_week(self, value):
        if any(day not in range(1, 8) for day in value):
            raise serializers.ValidationError("Weekdays must be ISO values from 1 through 7.")
        return sorted(set(value))

    def validate(self, attrs):
        instance = self.instance
        frequency = attrs.get(
            "frequency",
            getattr(instance, "frequency", TaskSchedule.Frequency.DAILY),
        )
        scheduled_time = attrs.get("time", getattr(instance, "time", None))
        specific_date = attrs.get("specific_date", getattr(instance, "specific_date", None))
        interval_hours = attrs.get("interval_hours", getattr(instance, "interval_hours", None))
        days_of_week = attrs.get("days_of_week", getattr(instance, "days_of_week", []))
        starts_on = attrs.get("starts_on", getattr(instance, "starts_on", None))
        ends_on = attrs.get("ends_on", getattr(instance, "ends_on", None))
        errors = {}

        if starts_on and ends_on and starts_on > ends_on:
            errors["ends_on"] = "The end date cannot be earlier than the start date."
        if specific_date and starts_on and specific_date < starts_on:
            errors["specific_date"] = "The one-time date cannot be earlier than the start date."
        if specific_date and ends_on and specific_date > ends_on:
            errors["specific_date"] = "The one-time date cannot be later than the end date."

        if frequency == TaskSchedule.Frequency.ONCE:
            if not specific_date:
                errors["specific_date"] = "Choose a date for a one-time task."
            if not scheduled_time:
                errors["time"] = "Choose a time for a one-time task."
        elif frequency == TaskSchedule.Frequency.DAILY:
            if not scheduled_time:
                errors["time"] = "Choose a time for a daily task."
        elif frequency == TaskSchedule.Frequency.WEEKLY:
            if not scheduled_time:
                errors["time"] = "Choose a time for a weekly task."
            if not days_of_week:
                errors["days_of_week"] = "Choose at least one weekday."
        elif frequency == TaskSchedule.Frequency.INTERVAL:
            if not interval_hours:
                errors["interval_hours"] = "Choose how many hours should pass between occurrences."
            elif interval_hours > 24:
                errors["interval_hours"] = "Intervals cannot be longer than 24 hours."
            if not scheduled_time:
                errors["time"] = "Choose the first time of day for an interval task."

        for field in ["window_before_minutes", "window_after_minutes"]:
            value = attrs.get(field, getattr(instance, field, 0))
            if value > 1440:
                errors[field] = "A completion window cannot exceed 24 hours."

        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class TaskSerializer(serializers.ModelSerializer):
    schedules = TaskScheduleSerializer(many=True, required=False)
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    assigned_to_name = serializers.CharField(source="assigned_to.display_name", read_only=True)

    class Meta:
        model = Task
        fields = [
            "id",
            "patient",
            "patient_name",
            "title",
            "category",
            "priority",
            "schedule_type",
            "instructions",
            "expected_outcome",
            "safety_notes",
            "equipment",
            "requires_note",
            "requires_photo",
            "assigned_to",
            "assigned_to_name",
            "client_reference",
            "active",
            "schedules",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        patient = attrs.get("patient", getattr(self.instance, "patient", None))
        assigned_to = attrs.get("assigned_to", getattr(self.instance, "assigned_to", None))
        schedules = attrs.get("schedules")
        schedule_type = attrs.get("schedule_type", getattr(self.instance, "schedule_type", Task.ScheduleType.SCHEDULED))
        if patient and assigned_to and not CareAssignment.objects.filter(patient=patient, user=assigned_to, active=True).exists():
            raise serializers.ValidationError({"assigned_to": "This user is not actively assigned to the patient."})
        if self.instance is None and schedule_type == Task.ScheduleType.SCHEDULED and not schedules:
            raise serializers.ValidationError({"schedules": "Add at least one schedule to the task."})
        if schedules:
            seen = set()
            for schedule in schedules:
                fingerprint = (
                    schedule.get("frequency", TaskSchedule.Frequency.DAILY),
                    schedule.get("time"),
                    schedule.get("specific_date"),
                    schedule.get("interval_hours"),
                    tuple(schedule.get("days_of_week", [])),
                    schedule.get("event_reference", "").strip().casefold(),
                )
                if fingerprint in seen:
                    raise serializers.ValidationError({"schedules": "The task contains a duplicate schedule."})
                seen.add(fingerprint)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        schedules = validated_data.pop("schedules", [])
        task = Task.objects.create(**validated_data)
        for schedule in schedules:
            TaskSchedule.objects.create(task=task, **schedule)
        return task

    @transaction.atomic
    def update(self, instance, validated_data):
        schedules = validated_data.pop("schedules", None)
        instance = super().update(instance, validated_data)
        if schedules is not None:
            instance.schedules.all().delete()
            for schedule in schedules:
                TaskSchedule.objects.create(task=instance, **schedule)
        return instance


class CareTaskTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CareTaskTemplate
        fields = [
            "id",
            "organization",
            "name",
            "title",
            "category",
            "priority",
            "instructions",
            "expected_outcome",
            "safety_notes",
            "equipment",
            "requires_note",
            "requires_photo",
            "schedule_defaults",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "organization", "created_at", "updated_at"]

    def validate_schedule_defaults(self, value):
        if not value:
            return value
        allowed = {choice for choice, _ in TaskSchedule.Frequency.choices}
        if value.get("frequency", TaskSchedule.Frequency.DAILY) not in allowed:
            raise serializers.ValidationError("Choose a supported frequency.")
        return value


class CompletionLogSerializer(serializers.ModelSerializer):
    completed_by_name = serializers.CharField(source="completed_by.display_name", read_only=True)

    class Meta:
        model = CompletionLog
        fields = ["id", "completed_by", "completed_by_name", "outcome", "note", "photo", "client_reference", "created_at"]
        read_only_fields = ["id", "completed_by", "created_at"]


class CompletionCorrectionSerializer(serializers.ModelSerializer):
    corrected_by_name = serializers.CharField(source="corrected_by.display_name", read_only=True)

    class Meta:
        model = CompletionCorrection
        fields = [
            "id",
            "previous_status",
            "corrected_status",
            "previous_outcome",
            "corrected_outcome",
            "reason",
            "note",
            "corrected_by",
            "corrected_by_name",
            "client_reference",
            "created_at",
        ]
        read_only_fields = fields


class TaskOccurrenceSerializer(serializers.ModelSerializer):
    task_detail = TaskSerializer(source="task", read_only=True)
    completion = CompletionLogSerializer(read_only=True)
    corrections = CompletionCorrectionSerializer(many=True, read_only=True)
    effective_scheduled_at = serializers.SerializerMethodField()

    class Meta:
        model = TaskOccurrence
        fields = [
            "id",
            "task",
            "task_detail",
            "schedule",
            "scheduled_at",
            "effective_scheduled_at",
            "status",
            "outcome",
            "version",
            "completed_at",
            "completed_by",
            "delayed_until",
            "completion",
            "corrections",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status", "outcome", "version", "completed_at", "completed_by", "created_at", "updated_at"]

    def get_effective_scheduled_at(self, obj):
        return obj.delayed_until or obj.scheduled_at


class CompleteOccurrenceSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=CompletionLog.Outcome.choices)
    note = serializers.CharField(required=False, allow_blank=True)
    photo = serializers.ImageField(required=False)
    client_reference = serializers.UUIDField(required=False)
    expected_version = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        occurrence = self.context["occurrence"]
        client_reference = attrs.get("client_reference")
        if client_reference:
            existing = CompletionLog.objects.filter(client_reference=client_reference).first()
            if existing:
                if existing.occurrence_id != occurrence.id:
                    raise serializers.ValidationError({"client_reference": "This reference belongs to a different completion."})
                self.existing_completion = existing
                return attrs
            existing_correction = CompletionCorrection.objects.filter(client_reference=client_reference).first()
            if existing_correction:
                if existing_correction.occurrence_id != occurrence.id:
                    raise serializers.ValidationError({"client_reference": "This reference belongs to a different outcome."})
                self.existing_reopened_outcome = True
                return attrs
        if attrs["expected_version"] != occurrence.version:
            raise VersionConflict(occurrence_state(occurrence))
        if occurrence.status == TaskOccurrence.Status.DONE:
            raise serializers.ValidationError("This task is already complete. Use correction to change its outcome.")
        if attrs["outcome"] != CompletionLog.Outcome.COMPLETED and not attrs.get("note", "").strip():
            raise serializers.ValidationError({"note": "Add a note for partial, unable, or refused care."})
        if occurrence.task.requires_note and not attrs.get("note", "").strip():
            raise serializers.ValidationError({"note": "A completion note is required for this task."})
        if occurrence.task.requires_photo and not attrs.get("photo"):
            raise serializers.ValidationError({"photo": "A completion photo is required for this task."})
        return attrs

    @transaction.atomic
    def save(self):
        if hasattr(self, "existing_completion"):
            return self.existing_completion
        if hasattr(self, "existing_reopened_outcome"):
            return CompletionLog.objects.get(occurrence=self.context["occurrence"])
        occurrence = TaskOccurrence.objects.select_for_update().get(pk=self.context["occurrence"].pk)
        if self.validated_data["expected_version"] != occurrence.version:
            raise VersionConflict(occurrence_state(occurrence))
        client_reference = self.validated_data.get("client_reference")
        if client_reference:
            existing = CompletionLog.objects.filter(client_reference=client_reference).first()
            if existing:
                return existing
            if CompletionCorrection.objects.filter(client_reference=client_reference, occurrence=occurrence).exists():
                return CompletionLog.objects.get(occurrence=occurrence)
        user = self.context["request"].user
        outcome = self.validated_data["outcome"]
        next_status = (
            TaskOccurrence.Status.DONE
            if outcome in [CompletionLog.Outcome.COMPLETED, CompletionLog.Outcome.PARTIAL]
            else TaskOccurrence.Status.MISSED
            if outcome == CompletionLog.Outcome.UNABLE
            else TaskOccurrence.Status.SKIPPED
        )
        completion = CompletionLog.objects.filter(occurrence=occurrence).first()
        if completion:
            CompletionCorrection.objects.create(
                occurrence=occurrence,
                previous_status=occurrence.status,
                corrected_status=next_status,
                previous_outcome=occurrence.outcome,
                corrected_outcome=outcome,
                reason="New care outcome after the record was reopened",
                note=self.validated_data.get("note", ""),
                corrected_by=user,
                client_reference=client_reference,
            )
        else:
            log_values = {key: value for key, value in self.validated_data.items() if key != "expected_version"}
            completion = CompletionLog.objects.create(occurrence=occurrence, completed_by=user, **log_values)
        occurrence.outcome = outcome
        occurrence.status = next_status
        occurrence.completed_at = timezone.now()
        occurrence.completed_by = user
        occurrence.version += 1
        occurrence.save(update_fields=["status", "outcome", "completed_at", "completed_by", "version", "updated_at"])
        record_audit(
            actor=user,
            patient=occurrence.task.patient,
            action="TASK_OUTCOME_RECORDED",
            instance=occurrence,
            summary=f"Recorded {outcome.lower()} outcome for {occurrence.task.title}",
            metadata={"status": occurrence.status, "outcome": outcome, "note": self.validated_data.get("note", "")},
            client_reference=client_reference,
        )
        resolve_source_alerts("task_occurrence", occurrence.id)
        return completion


class CorrectOccurrenceSerializer(serializers.Serializer):
    corrected_status = serializers.ChoiceField(
        choices=[
            TaskOccurrence.Status.PENDING,
            TaskOccurrence.Status.DONE,
            TaskOccurrence.Status.MISSED,
            TaskOccurrence.Status.SKIPPED,
        ]
    )
    corrected_outcome = serializers.ChoiceField(choices=CompletionLog.Outcome.choices, required=False, allow_blank=True)
    reason = serializers.CharField(max_length=255)
    note = serializers.CharField(required=False, allow_blank=True)
    client_reference = serializers.UUIDField(required=False)
    expected_version = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        occurrence = self.context["occurrence"]
        reference = attrs.get("client_reference")
        if reference:
            existing = CompletionCorrection.objects.filter(client_reference=reference).first()
            if existing:
                if existing.occurrence_id != occurrence.id:
                    raise serializers.ValidationError({"client_reference": "This reference belongs to another correction."})
                self.existing_correction = existing
                return attrs
        if attrs["expected_version"] != occurrence.version:
            raise VersionConflict(occurrence_state(occurrence))
        if attrs["corrected_status"] == TaskOccurrence.Status.DONE and not attrs.get("corrected_outcome"):
            attrs["corrected_outcome"] = CompletionLog.Outcome.COMPLETED
        return attrs

    @transaction.atomic
    def save(self):
        if hasattr(self, "existing_correction"):
            return self.existing_correction
        occurrence = TaskOccurrence.objects.select_for_update().get(pk=self.context["occurrence"].pk)
        if self.validated_data["expected_version"] != occurrence.version:
            raise VersionConflict(occurrence_state(occurrence))
        user = self.context["request"].user
        correction = CompletionCorrection.objects.create(
            occurrence=occurrence,
            previous_status=occurrence.status,
            corrected_status=self.validated_data["corrected_status"],
            previous_outcome=occurrence.outcome,
            corrected_outcome=self.validated_data.get("corrected_outcome", ""),
            reason=self.validated_data["reason"],
            note=self.validated_data.get("note", ""),
            corrected_by=user,
            client_reference=self.validated_data.get("client_reference"),
        )
        occurrence.status = correction.corrected_status
        occurrence.outcome = correction.corrected_outcome
        occurrence.version += 1
        if occurrence.status == TaskOccurrence.Status.PENDING:
            occurrence.completed_at = None
            occurrence.completed_by = None
        else:
            occurrence.completed_at = timezone.now()
            occurrence.completed_by = user
        occurrence.save(update_fields=["status", "outcome", "version", "completed_at", "completed_by", "updated_at"])
        record_audit(
            actor=user,
            patient=occurrence.task.patient,
            action="TASK_OUTCOME_CORRECTED",
            instance=occurrence,
            summary=f"Corrected outcome for {occurrence.task.title}",
            metadata={
                "from_status": correction.previous_status,
                "to_status": correction.corrected_status,
                "from_outcome": correction.previous_outcome,
                "to_outcome": correction.corrected_outcome,
                "reason": correction.reason,
            },
            client_reference=correction.client_reference,
        )
        if occurrence.status != TaskOccurrence.Status.PENDING:
            resolve_source_alerts("task_occurrence", occurrence.id)
        return correction


class DelayOccurrenceSerializer(serializers.Serializer):
    delayed_until = serializers.DateTimeField()
    reason = serializers.CharField(max_length=255)
    expected_version = serializers.IntegerField(min_value=1)

    def validate_delayed_until(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("The delayed time must be in the future.")
        return value


class SkipOccurrenceSerializer(serializers.Serializer):
    outcome = serializers.ChoiceField(choices=[CompletionLog.Outcome.UNABLE, CompletionLog.Outcome.REFUSED])
    note = serializers.CharField()
    expected_version = serializers.IntegerField(min_value=1)
