from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.common.exceptions import VersionConflict
from apps.safety.services import record_audit, resolve_source_alerts

from .models import (
    DoseCorrection,
    DoseLog,
    Medication,
    MedicationInteraction,
    MedicationSchedule,
    RefillRequest,
    StockAdjustment,
)


def dose_state(dose):
    return {
        "id": dose.id,
        "status": dose.status,
        "version": dose.version,
        "note": dose.note,
        "updated_at": dose.updated_at.isoformat(),
    }


class MedicationScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicationSchedule
        fields = ["id", "time", "days_of_week", "instructions"]
        read_only_fields = ["id"]


class MedicationSerializer(serializers.ModelSerializer):
    schedules = MedicationScheduleSerializer(many=True, required=False)
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.display_name", read_only=True)
    warnings = serializers.SerializerMethodField()

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
            "medication_code",
            "code_system",
            "barcode",
            "starts_on",
            "ends_on",
            "is_prn",
            "prn_reason",
            "max_daily_doses",
            "approval_status",
            "approved_by",
            "approved_by_name",
            "approved_at",
            "prescriber",
            "warnings",
            "schedules",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "approval_status", "approved_by", "approved_at", "created_at", "updated_at"]

    def validate(self, attrs):
        from apps.clinical.models import Allergy

        patient = attrs.get("patient", getattr(self.instance, "patient", None))
        name = attrs.get("name", getattr(self.instance, "name", ""))
        if patient and Allergy.objects.filter(patient=patient, active=True, substance__iexact=name).exists():
            raise serializers.ValidationError({"name": "This medication matches an active allergy record."})
        duplicates = Medication.objects.filter(patient=patient, active=True, name__iexact=name)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if patient and duplicates.exists():
            raise serializers.ValidationError({"name": "An active medication with this name already exists."})
        if patient:
            active_names = list(Medication.objects.filter(patient=patient, active=True).values_list("name", flat=True))
            severe = MedicationInteraction.objects.filter(
                active=True, severity=MedicationInteraction.Severity.SEVERE, organization__in=[patient.organization, None]
            )
            for interaction in severe:
                pair = {interaction.medication_a.lower(), interaction.medication_b.lower()}
                if name.lower() in pair and any(active.lower() in pair - {name.lower()} for active in active_names):
                    raise serializers.ValidationError({"name": f"Severe interaction: {interaction.message}"})
        return attrs

    def get_warnings(self, obj):
        active_names = list(obj.patient.medications.filter(active=True).exclude(pk=obj.pk).values_list("name", flat=True))
        warnings = []
        interactions = MedicationInteraction.objects.filter(active=True, organization__in=[obj.patient.organization, None])
        for interaction in interactions:
            pair = {interaction.medication_a.lower(), interaction.medication_b.lower()}
            if obj.name.lower() in pair and any(name.lower() in pair - {obj.name.lower()} for name in active_names):
                warnings.append({"severity": interaction.severity, "message": interaction.message, "source": interaction.source})
        return warnings

    @transaction.atomic
    def create(self, validated_data):
        schedules = validated_data.pop("schedules", [])
        medication = Medication.objects.create(**validated_data)
        for schedule in schedules:
            MedicationSchedule.objects.create(medication=medication, **schedule)
        return medication

    @transaction.atomic
    def update(self, instance, validated_data):
        schedules = validated_data.pop("schedules", None)
        instance = super().update(instance, validated_data)
        if schedules is not None:
            instance.schedules.all().delete()
            for schedule in schedules:
                MedicationSchedule.objects.create(medication=instance, **schedule)
        return instance


class DoseCorrectionSerializer(serializers.ModelSerializer):
    corrected_by_name = serializers.CharField(source="corrected_by.display_name", read_only=True)

    class Meta:
        model = DoseCorrection
        fields = [
            "id",
            "previous_status",
            "corrected_status",
            "reason",
            "note",
            "corrected_by",
            "corrected_by_name",
            "client_reference",
            "created_at",
        ]
        read_only_fields = fields


class DoseLogSerializer(serializers.ModelSerializer):
    medication_name = serializers.CharField(source="medication.name", read_only=True)
    patient = serializers.IntegerField(source="medication.patient_id", read_only=True)
    patient_name = serializers.CharField(source="medication.patient.full_name", read_only=True)
    dose = serializers.DecimalField(source="medication.dose", max_digits=10, decimal_places=2, read_only=True)
    unit = serializers.CharField(source="medication.unit", read_only=True)
    route = serializers.CharField(source="medication.route", read_only=True)
    administered_by_name = serializers.CharField(source="administered_by.display_name", read_only=True)
    corrections = DoseCorrectionSerializer(many=True, read_only=True)

    class Meta:
        model = DoseLog
        fields = [
            "id",
            "medication",
            "medication_name",
            "patient",
            "patient_name",
            "dose",
            "unit",
            "route",
            "scheduled_at",
            "status",
            "version",
            "administered_at",
            "administered_by",
            "administered_by_name",
            "note",
            "client_reference",
            "verified_patient",
            "verified_medication",
            "verified_dose",
            "verified_route",
            "verified_time",
            "was_late",
            "late_minutes",
            "is_prn",
            "corrections",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "version",
            "administered_at",
            "administered_by",
            "note",
            "client_reference",
            "verified_patient",
            "verified_medication",
            "verified_dose",
            "verified_route",
            "verified_time",
            "was_late",
            "late_minutes",
            "is_prn",
            "created_at",
            "updated_at",
        ]


class AdministerDoseSerializer(serializers.Serializer):
    expected_version = serializers.IntegerField(min_value=1)
    note = serializers.CharField(required=False, allow_blank=True)
    client_reference = serializers.UUIDField(required=False)
    verified_patient = serializers.BooleanField()
    verified_medication = serializers.BooleanField()
    verified_dose = serializers.BooleanField()
    verified_route = serializers.BooleanField()
    verified_time = serializers.BooleanField()

    def validate(self, attrs):
        dose = self.context["dose"]
        reference = attrs.get("client_reference")
        if reference and dose.client_reference == reference and dose.status == DoseLog.Status.GIVEN:
            self.replay = True
            return attrs
        if reference and DoseLog.objects.exclude(pk=dose.pk).filter(client_reference=reference).exists():
            raise serializers.ValidationError({"client_reference": "This reference belongs to another dose."})
        if attrs["expected_version"] != dose.version:
            raise VersionConflict(dose_state(dose))
        missing = [
            label
            for field, label in [
                ("verified_patient", "patient"),
                ("verified_medication", "medication"),
                ("verified_dose", "dose"),
                ("verified_route", "route"),
                ("verified_time", "time"),
            ]
            if not attrs[field]
        ]
        if missing:
            raise serializers.ValidationError({"verification": f"Confirm the {', '.join(missing)} before administration."})
        if dose.status != DoseLog.Status.SCHEDULED:
            raise serializers.ValidationError("This dose already has an outcome. Use correction if it is wrong.")
        medication = dose.medication
        today = timezone.localdate()
        if medication.approval_status != Medication.ApprovalStatus.APPROVED:
            raise serializers.ValidationError("This medication order is not clinically approved.")
        if medication.starts_on and today < medication.starts_on:
            raise serializers.ValidationError("This medication order has not started yet.")
        if medication.ends_on and today > medication.ends_on:
            raise serializers.ValidationError("This medication order has ended.")
        if medication.max_daily_doses:
            given_today = (
                DoseLog.objects.filter(medication=medication, status=DoseLog.Status.GIVEN, administered_at__date=today)
                .exclude(pk=dose.pk)
                .count()
            )
            if given_today >= medication.max_daily_doses:
                raise serializers.ValidationError("The maximum daily dose count has already been reached.")
        return attrs

    @transaction.atomic
    def save(self):
        dose = DoseLog.objects.select_for_update().select_related("medication", "medication__patient").get(pk=self.context["dose"].pk)
        if getattr(self, "replay", False):
            return dose
        if self.validated_data["expected_version"] != dose.version:
            raise VersionConflict(dose_state(dose))
        user = self.context["request"].user
        dose.status = DoseLog.Status.GIVEN
        dose.administered_at = timezone.now()
        dose.administered_by = user
        dose.note = self.validated_data.get("note", "")
        dose.client_reference = self.validated_data.get("client_reference")
        dose.late_minutes = max(0, int((dose.administered_at - dose.scheduled_at).total_seconds() // 60))
        dose.was_late = dose.late_minutes > 30
        for field in ["verified_patient", "verified_medication", "verified_dose", "verified_route", "verified_time"]:
            setattr(dose, field, self.validated_data[field])
        dose.version += 1
        dose.save(
            update_fields=[
                "status",
                "administered_at",
                "administered_by",
                "note",
                "client_reference",
                "version",
                "verified_patient",
                "verified_medication",
                "verified_dose",
                "verified_route",
                "verified_time",
                "was_late",
                "late_minutes",
                "updated_at",
            ]
        )
        medication = Medication.objects.select_for_update().get(pk=dose.medication_id)
        if medication.stock_quantity:
            medication.stock_quantity -= 1
            medication.save(update_fields=["stock_quantity", "updated_at"])
        record_audit(
            actor=user,
            patient=dose.medication.patient,
            action="MEDICATION_GIVEN",
            instance=dose,
            summary=f"Administered {dose.medication.name} {dose.medication.dose:g} {dose.medication.unit}",
            metadata={"route": dose.medication.route, "scheduled_at": dose.scheduled_at.isoformat(), "note": dose.note},
            client_reference=dose.client_reference,
        )
        resolve_source_alerts("dose_log", dose.id)
        return dose


class DoseOutcomeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[DoseLog.Status.MISSED, DoseLog.Status.REFUSED, DoseLog.Status.HELD])
    reason = serializers.CharField()
    expected_version = serializers.IntegerField(min_value=1)
    client_reference = serializers.UUIDField(required=False)

    def validate(self, attrs):
        dose = self.context["dose"]
        reference = attrs.get("client_reference")
        if reference and dose.client_reference == reference and dose.status == attrs["status"]:
            self.replay = True
            return attrs
        if reference and DoseLog.objects.exclude(pk=dose.pk).filter(client_reference=reference).exists():
            raise serializers.ValidationError({"client_reference": "This reference belongs to another dose."})
        if attrs["expected_version"] != dose.version:
            raise VersionConflict(dose_state(dose))
        if dose.status != DoseLog.Status.SCHEDULED:
            raise serializers.ValidationError("This dose already has an outcome. Use correction if it is wrong.")
        return attrs

    @transaction.atomic
    def save(self):
        dose = DoseLog.objects.select_for_update().select_related("medication", "medication__patient").get(pk=self.context["dose"].pk)
        if getattr(self, "replay", False):
            return dose
        if self.validated_data["expected_version"] != dose.version:
            raise VersionConflict(dose_state(dose))
        dose.status = self.validated_data["status"]
        dose.note = self.validated_data["reason"]
        dose.administered_at = timezone.now()
        dose.administered_by = self.context["request"].user
        dose.client_reference = self.validated_data.get("client_reference")
        dose.version += 1
        dose.save(update_fields=["status", "note", "administered_at", "administered_by", "client_reference", "version", "updated_at"])
        record_audit(
            actor=self.context["request"].user,
            patient=dose.medication.patient,
            action=f"MEDICATION_{dose.status}",
            instance=dose,
            summary=f"Recorded {dose.status.lower()} outcome for {dose.medication.name}",
            metadata={"reason": dose.note},
            client_reference=dose.client_reference,
        )
        resolve_source_alerts("dose_log", dose.id)
        return dose


class CorrectDoseSerializer(serializers.Serializer):
    corrected_status = serializers.ChoiceField(choices=DoseLog.Status.choices)
    reason = serializers.CharField(max_length=255)
    note = serializers.CharField(required=False, allow_blank=True)
    expected_version = serializers.IntegerField(min_value=1)
    client_reference = serializers.UUIDField(required=False)

    def validate(self, attrs):
        dose = self.context["dose"]
        reference = attrs.get("client_reference")
        if reference:
            existing = DoseCorrection.objects.filter(client_reference=reference).first()
            if existing:
                if existing.dose_log_id != dose.id:
                    raise serializers.ValidationError({"client_reference": "This reference belongs to another correction."})
                self.existing = existing
                return attrs
        if attrs["expected_version"] != dose.version:
            raise VersionConflict(dose_state(dose))
        return attrs

    @transaction.atomic
    def save(self):
        if hasattr(self, "existing"):
            return self.existing
        dose = DoseLog.objects.select_for_update().select_related("medication", "medication__patient").get(pk=self.context["dose"].pk)
        if self.validated_data["expected_version"] != dose.version:
            raise VersionConflict(dose_state(dose))
        user = self.context["request"].user
        correction = DoseCorrection.objects.create(
            dose_log=dose,
            previous_status=dose.status,
            corrected_status=self.validated_data["corrected_status"],
            reason=self.validated_data["reason"],
            note=self.validated_data.get("note", ""),
            corrected_by=user,
            client_reference=self.validated_data.get("client_reference"),
        )
        previous_status = dose.status
        dose.status = correction.corrected_status
        dose.note = correction.note
        dose.version += 1
        if dose.status == DoseLog.Status.SCHEDULED:
            dose.administered_at = None
            dose.administered_by = None
        else:
            dose.administered_at = timezone.now()
            dose.administered_by = user
        dose.save(update_fields=["status", "note", "version", "administered_at", "administered_by", "updated_at"])
        medication = Medication.objects.select_for_update().get(pk=dose.medication_id)
        if previous_status == DoseLog.Status.GIVEN and dose.status != DoseLog.Status.GIVEN:
            medication.stock_quantity = (medication.stock_quantity or 0) + 1
            medication.save(update_fields=["stock_quantity", "updated_at"])
        elif previous_status != DoseLog.Status.GIVEN and dose.status == DoseLog.Status.GIVEN and medication.stock_quantity:
            medication.stock_quantity -= 1
            medication.save(update_fields=["stock_quantity", "updated_at"])
        record_audit(
            actor=user,
            patient=dose.medication.patient,
            action="MEDICATION_OUTCOME_CORRECTED",
            instance=dose,
            summary=f"Corrected dose outcome for {dose.medication.name}",
            metadata={"from_status": correction.previous_status, "to_status": correction.corrected_status, "reason": correction.reason},
            client_reference=correction.client_reference,
        )
        if dose.status != DoseLog.Status.SCHEDULED:
            resolve_source_alerts("dose_log", dose.id)
        return correction


class MedicationInteractionSerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicationInteraction
        fields = [
            "id",
            "organization",
            "medication_a",
            "medication_b",
            "severity",
            "message",
            "source",
            "active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class RefillRequestSerializer(serializers.ModelSerializer):
    medication_name = serializers.CharField(source="medication.name", read_only=True)
    requested_by_name = serializers.CharField(source="requested_by.display_name", read_only=True)

    class Meta:
        model = RefillRequest
        fields = [
            "id",
            "medication",
            "medication_name",
            "requested_by",
            "requested_by_name",
            "quantity",
            "status",
            "note",
            "resolved_by",
            "resolved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "requested_by", "resolved_by", "resolved_at", "created_at", "updated_at"]


class StockAdjustmentSerializer(serializers.ModelSerializer):
    medication_name = serializers.CharField(source="medication.name", read_only=True)
    recorded_by_name = serializers.CharField(source="recorded_by.display_name", read_only=True)

    class Meta:
        model = StockAdjustment
        fields = [
            "id",
            "medication",
            "medication_name",
            "quantity_delta",
            "reason",
            "recorded_by",
            "recorded_by_name",
            "resulting_quantity",
            "created_at",
        ]
        read_only_fields = ["id", "recorded_by", "resulting_quantity", "created_at"]
