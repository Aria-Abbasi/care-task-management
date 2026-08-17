from rest_framework import serializers

from .models import (
    AdvanceDirective,
    Allergy,
    CarePlan,
    ClinicalDocument,
    Diagnosis,
    EmergencyContact,
    FoodIntakeLog,
    MealDefinition,
    VitalThreshold,
    WoundRecord,
)


class PatientNamedSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)


class AllergySerializer(PatientNamedSerializer):
    class Meta:
        model = Allergy
        fields = [
            "id",
            "patient",
            "patient_name",
            "substance",
            "reaction",
            "severity",
            "active",
            "recorded_by",
            "source_system",
            "external_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "recorded_by", "created_at", "updated_at"]


class DiagnosisSerializer(PatientNamedSerializer):
    class Meta:
        model = Diagnosis
        fields = [
            "id",
            "patient",
            "patient_name",
            "code",
            "code_system",
            "display",
            "status",
            "diagnosed_at",
            "notes",
            "recorded_by",
            "source_system",
            "external_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "recorded_by", "created_at", "updated_at"]


class CarePlanSerializer(PatientNamedSerializer):
    author_name = serializers.CharField(source="author.display_name", read_only=True)

    class Meta:
        model = CarePlan
        fields = [
            "id",
            "patient",
            "patient_name",
            "title",
            "status",
            "goals",
            "instructions",
            "starts_on",
            "ends_on",
            "author",
            "author_name",
            "source_system",
            "external_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "author", "created_at", "updated_at"]


class EmergencyContactSerializer(PatientNamedSerializer):
    class Meta:
        model = EmergencyContact
        fields = [
            "id",
            "patient",
            "patient_name",
            "name",
            "relationship",
            "phone",
            "email",
            "priority",
            "authorized_for_updates",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class AdvanceDirectiveSerializer(PatientNamedSerializer):
    document = serializers.SerializerMethodField()
    document_upload = serializers.FileField(source="document", write_only=True, required=False)

    class Meta:
        model = AdvanceDirective
        fields = [
            "id",
            "patient",
            "patient_name",
            "directive_type",
            "summary",
            "document",
            "document_upload",
            "effective_from",
            "reviewed_at",
            "active",
            "recorded_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "recorded_by", "created_at", "updated_at"]

    def get_document(self, obj):
        return f"/api/v1/advance-directives/{obj.id}/download/" if obj.document else ""


class ClinicalDocumentSerializer(PatientNamedSerializer):
    file = serializers.SerializerMethodField()
    file_upload = serializers.FileField(source="file", write_only=True)

    class Meta:
        model = ClinicalDocument
        fields = [
            "id",
            "patient",
            "patient_name",
            "title",
            "category",
            "file",
            "file_upload",
            "checksum_sha256",
            "uploaded_by",
            "retention_until",
            "source_system",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "checksum_sha256", "uploaded_by", "created_at", "updated_at"]

    def get_file(self, obj):
        return f"/api/v1/clinical-documents/{obj.id}/download/"


class WoundRecordSerializer(PatientNamedSerializer):
    photo = serializers.SerializerMethodField()
    photo_upload = serializers.FileField(source="photo", write_only=True, required=False)

    class Meta:
        model = WoundRecord
        fields = [
            "id",
            "patient",
            "patient_name",
            "location",
            "description",
            "length_cm",
            "width_cm",
            "photo",
            "photo_upload",
            "recorded_at",
            "recorded_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "recorded_by", "created_at", "updated_at"]

    def get_photo(self, obj):
        return f"/api/v1/wound-records/{obj.id}/download/" if obj.photo else ""


class VitalThresholdSerializer(PatientNamedSerializer):
    class Meta:
        model = VitalThreshold
        fields = [
            "id",
            "patient",
            "patient_name",
            "vital_type",
            "minimum",
            "maximum",
            "secondary_minimum",
            "secondary_maximum",
            "severity",
            "consecutive_readings",
            "active",
            "configured_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "configured_by", "created_at", "updated_at"]


class MealDefinitionSerializer(PatientNamedSerializer):
    created_by_name = serializers.CharField(source="created_by.display_name", read_only=True)
    meal_type_display = serializers.CharField(source="get_meal_type_display", read_only=True)

    class Meta:
        model = MealDefinition
        fields = [
            "id",
            "patient",
            "patient_name",
            "name",
            "meal_type",
            "meal_type_display",
            "instructions",
            "ingredients",
            "dietary_tags",
            "target_time",
            "active",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def validate_name(self, value):
        cleaned = value.strip()
        if not cleaned:
            raise serializers.ValidationError("Meal name cannot be empty.")
        return cleaned


class FoodIntakeLogSerializer(PatientNamedSerializer):
    recorded_by_name = serializers.CharField(source="recorded_by.display_name", read_only=True)

    class Meta:
        model = FoodIntakeLog
        fields = [
            "id",
            "patient",
            "patient_name",
            "meal_definition",
            "meal_type",
            "meal_name",
            "portion_consumed",
            "recorded_at",
            "recorded_by",
            "recorded_by_name",
            "notes",
            "client_reference",
            "provenance",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "recorded_by", "created_at", "updated_at"]

    def validate_portion_consumed(self, value):
        if not (0 <= value <= 100):
            raise serializers.ValidationError("Portion consumed must be between 0 and 100%.")
        return value

    def validate(self, attrs):
        meal_name = attrs.get("meal_name", "").strip()
        meal_def = attrs.get("meal_definition")
        if not meal_name and meal_def:
            attrs["meal_name"] = meal_def.name
            if not attrs.get("meal_type"):
                attrs["meal_type"] = meal_def.meal_type
        if not attrs.get("meal_name", "").strip():
            raise serializers.ValidationError({"meal_name": "Meal name is required."})
        return attrs
