from rest_framework import serializers

from .models import VitalRecord


class VitalRecordSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.display_name", read_only=True)

    class Meta:
        model = VitalRecord
        fields = [
            "id",
            "patient",
            "patient_name",
            "type",
            "value",
            "secondary_value",
            "unit",
            "recorded_at",
            "recorded_by",
            "recorded_by_name",
            "note",
            "client_reference",
            "source_system",
            "external_id",
            "provenance",
            "created_at",
        ]
        read_only_fields = ["id", "recorded_by", "created_at"]

    def validate(self, attrs):
        record_type = attrs.get("type", getattr(self.instance, "type", None))
        secondary = attrs.get("secondary_value", getattr(self.instance, "secondary_value", None))
        if record_type == VitalRecord.Type.BLOOD_PRESSURE and secondary is None:
            raise serializers.ValidationError({"secondary_value": "Diastolic pressure is required for blood pressure."})
        return attrs
