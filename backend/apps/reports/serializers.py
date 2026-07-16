from django.utils import timezone
from rest_framework import serializers

from apps.patients.models import CareAssignment

from .models import ShiftReport


class ShiftReportSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    author_name = serializers.CharField(source="author.display_name", read_only=True)
    recipient_name = serializers.CharField(source="recipient.display_name", read_only=True)

    class Meta:
        model = ShiftReport
        fields = [
            "id",
            "patient",
            "patient_name",
            "author",
            "author_name",
            "recipient",
            "recipient_name",
            "shift_started_at",
            "shift_ended_at",
            "observations",
            "concerns",
            "client_reference",
            "status",
            "sent_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "author", "sent_at", "created_at", "updated_at"]

    def validate(self, attrs):
        start = attrs.get("shift_started_at", getattr(self.instance, "shift_started_at", None))
        end = attrs.get("shift_ended_at", getattr(self.instance, "shift_ended_at", None))
        if start and end and end <= start:
            raise serializers.ValidationError({"shift_ended_at": "The shift must end after it starts."})
        patient = attrs.get("patient", getattr(self.instance, "patient", None))
        recipient = attrs.get("recipient", getattr(self.instance, "recipient", None))
        if patient and recipient and not CareAssignment.objects.filter(patient=patient, user=recipient, active=True).exists():
            raise serializers.ValidationError({"recipient": "This user is not actively assigned to the patient."})
        return attrs

    def update(self, instance, validated_data):
        status = validated_data.get("status")
        if status == ShiftReport.Status.SENT and instance.status != ShiftReport.Status.SENT:
            validated_data["sent_at"] = timezone.now()
        return super().update(instance, validated_data)

    def create(self, validated_data):
        if validated_data.get("status") == ShiftReport.Status.SENT:
            validated_data["sent_at"] = timezone.now()
        return super().create(validated_data)
