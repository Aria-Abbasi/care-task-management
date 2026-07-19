from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import CareAssignment, Patient


class PatientSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    age = serializers.SerializerMethodField()

    class Meta:
        model = Patient
        fields = [
            "id",
            "first_name",
            "last_name",
            "full_name",
            "birth_date",
            "age",
            "gender",
            "room",
            "medical_notes",
            "photo",
            "active",
            "organization",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_age(self, obj):
        from django.utils import timezone

        today = timezone.localdate()
        return today.year - obj.birth_date.year - ((today.month, today.day) < (obj.birth_date.month, obj.birth_date.day))


class CareAssignmentSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source="user", read_only=True)
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)

    class Meta:
        model = CareAssignment
        fields = ["id", "user", "user_detail", "patient", "patient_name", "relationship", "active", "starts_at", "ends_at", "created_at"]
        read_only_fields = ["id", "created_at"]
