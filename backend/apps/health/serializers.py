from django.utils.text import slugify
from rest_framework import serializers

from .models import CustomVitalType, VitalRecord


class CustomVitalTypeSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source="created_by.display_name", read_only=True)
    slug = serializers.SlugField(required=False, allow_blank=True)

    class Meta:
        model = CustomVitalType
        fields = [
            "id",
            "name",
            "slug",
            "unit",
            "description",
            "organization",
            "created_by",
            "created_by_name",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "organization", "created_by", "created_at", "updated_at"]
        validators = []

    def validate_name(self, value):
        cleaned = value.strip()
        if not cleaned:
            raise serializers.ValidationError("Name cannot be empty.")
        return cleaned

    def validate_unit(self, value):
        cleaned = value.strip()
        if not cleaned:
            raise serializers.ValidationError("Unit cannot be empty.")
        return cleaned

    def validate(self, attrs):
        name = attrs.get("name", getattr(self.instance, "name", "")).strip()
        slug = attrs.get("slug", getattr(self.instance, "slug", "")).strip()
        if not slug:
            generated = slugify(name).replace("-", "_").upper()
            slug = generated if generated else "CUSTOM_VITAL"
            attrs["slug"] = slug

        if attrs["slug"] in VitalRecord.Type.values:
            raise serializers.ValidationError({"name": "This matches a built-in vital type."})

        request = self.context.get("request")
        organization = getattr(request.user, "organization", None) if request and request.user.is_authenticated else None
        queryset = CustomVitalType.objects.filter(active=True)
        if organization:
            queryset = queryset.filter(organization=organization)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.filter(slug=attrs["slug"]).exists() or queryset.filter(name__iexact=name).exists():
            raise serializers.ValidationError({"name": "A vital type with this name or code already exists."})

        return attrs


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
        if record_type and record_type not in VitalRecord.Type.values:
            if not CustomVitalType.objects.filter(slug=record_type, active=True).exists():
                raise serializers.ValidationError({"type": "Invalid or unknown vital type."})
        return attrs
