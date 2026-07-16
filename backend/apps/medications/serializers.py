from rest_framework import serializers

from .models import DoseLog, Medication, MedicationSchedule


class MedicationScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicationSchedule
        fields = ["id", "time", "days_of_week", "instructions"]
        read_only_fields = ["id"]


class MedicationSerializer(serializers.ModelSerializer):
    schedules = MedicationScheduleSerializer(many=True, required=False)
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)

    class Meta:
        model = Medication
        fields = [
            "id",
            "patient",
            "patient_name",
            "name",
            "dose",
            "unit",
            "route",
            "instructions",
            "photo",
            "stock_quantity",
            "active",
            "schedules",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        schedules = validated_data.pop("schedules", [])
        medication = Medication.objects.create(**validated_data)
        for schedule in schedules:
            MedicationSchedule.objects.create(medication=medication, **schedule)
        return medication

    def update(self, instance, validated_data):
        schedules = validated_data.pop("schedules", None)
        instance = super().update(instance, validated_data)
        if schedules is not None:
            instance.schedules.all().delete()
            for schedule in schedules:
                MedicationSchedule.objects.create(medication=instance, **schedule)
        return instance


class DoseLogSerializer(serializers.ModelSerializer):
    medication_name = serializers.CharField(source="medication.name", read_only=True)
    administered_by_name = serializers.CharField(source="administered_by.display_name", read_only=True)

    class Meta:
        model = DoseLog
        fields = [
            "id",
            "medication",
            "medication_name",
            "scheduled_at",
            "status",
            "administered_at",
            "administered_by",
            "administered_by_name",
            "note",
            "client_reference",
            "created_at",
        ]
        read_only_fields = ["id", "administered_at", "administered_by", "created_at"]
