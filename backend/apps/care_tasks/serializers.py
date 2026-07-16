from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.patients.models import CareAssignment

from .models import CompletionLog, Task, TaskOccurrence, TaskSchedule


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
            "instructions",
            "assigned_to",
            "assigned_to_name",
            "active",
            "schedules",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        patient = attrs.get("patient", getattr(self.instance, "patient", None))
        assigned_to = attrs.get("assigned_to", getattr(self.instance, "assigned_to", None))
        if patient and assigned_to and not CareAssignment.objects.filter(patient=patient, user=assigned_to, active=True).exists():
            raise serializers.ValidationError({"assigned_to": "This user is not actively assigned to the patient."})
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


class CompletionLogSerializer(serializers.ModelSerializer):
    completed_by_name = serializers.CharField(source="completed_by.display_name", read_only=True)

    class Meta:
        model = CompletionLog
        fields = ["id", "completed_by", "completed_by_name", "note", "photo", "client_reference", "created_at"]
        read_only_fields = ["id", "completed_by", "created_at"]


class TaskOccurrenceSerializer(serializers.ModelSerializer):
    task_detail = TaskSerializer(source="task", read_only=True)
    completion = CompletionLogSerializer(read_only=True)
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
            "completed_at",
            "completed_by",
            "delayed_until",
            "completion",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "status", "completed_at", "completed_by", "created_at", "updated_at"]

    def get_effective_scheduled_at(self, obj):
        return obj.delayed_until or obj.scheduled_at


class CompleteOccurrenceSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True)
    photo = serializers.ImageField(required=False)
    client_reference = serializers.UUIDField(required=False)

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
        if occurrence.status == TaskOccurrence.Status.DONE:
            raise serializers.ValidationError("This task is already complete.")
        return attrs

    @transaction.atomic
    def save(self):
        if hasattr(self, "existing_completion"):
            return self.existing_completion
        occurrence = TaskOccurrence.objects.select_for_update().get(pk=self.context["occurrence"].pk)
        client_reference = self.validated_data.get("client_reference")
        if client_reference:
            existing = CompletionLog.objects.filter(client_reference=client_reference).first()
            if existing:
                if existing.occurrence_id != occurrence.id:
                    raise serializers.ValidationError({"client_reference": "This reference belongs to a different completion."})
                return existing
        if occurrence.status == TaskOccurrence.Status.DONE:
            raise serializers.ValidationError("This task is already complete.")
        user = self.context["request"].user
        now = timezone.now()
        completion = CompletionLog.objects.create(occurrence=occurrence, completed_by=user, **self.validated_data)
        occurrence.status = TaskOccurrence.Status.DONE
        occurrence.completed_at = now
        occurrence.completed_by = user
        occurrence.save(update_fields=["status", "completed_at", "completed_by", "updated_at"])
        return completion


class DelayOccurrenceSerializer(serializers.Serializer):
    delayed_until = serializers.DateTimeField()

    def validate_delayed_until(self, value):
        if value <= timezone.now():
            raise serializers.ValidationError("The delayed time must be in the future.")
        return value
