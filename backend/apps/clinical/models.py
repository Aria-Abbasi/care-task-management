import hashlib

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from apps.common.models import TimeStampedModel
from apps.health.models import VitalRecord
from apps.patients.models import Patient


def validate_clinical_file(value):
    allowed = {"application/pdf", "image/jpeg", "image/png", "audio/webm", "audio/mpeg"}
    content_type = getattr(value.file, "content_type", "")
    if content_type and content_type not in allowed:
        raise ValidationError("Unsupported clinical file type.")
    if value.size > 10 * 1024 * 1024:
        raise ValidationError("Clinical files must be 10 MB or smaller.")


class Allergy(TimeStampedModel):
    class Severity(models.TextChoices):
        MILD = "MILD", "Mild"
        MODERATE = "MODERATE", "Moderate"
        SEVERE = "SEVERE", "Severe"
        LIFE_THREATENING = "LIFE_THREATENING", "Life threatening"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="allergies")
    substance = models.CharField(max_length=200)
    reaction = models.TextField(blank=True)
    severity = models.CharField(max_length=24, choices=Severity.choices)
    active = models.BooleanField(default=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    source_system = models.CharField(max_length=120, blank=True)
    external_id = models.CharField(max_length=160, blank=True)

    class Meta:
        ordering = ["substance"]


class Diagnosis(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        RESOLVED = "RESOLVED", "Resolved"
        INACTIVE = "INACTIVE", "Inactive"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="diagnoses")
    code = models.CharField(max_length=64, blank=True)
    code_system = models.CharField(max_length=160, blank=True)
    display = models.CharField(max_length=255)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ACTIVE)
    diagnosed_at = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    source_system = models.CharField(max_length=120, blank=True)
    external_id = models.CharField(max_length=160, blank=True)

    class Meta:
        ordering = ["display"]


class CarePlan(TimeStampedModel):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        ACTIVE = "ACTIVE", "Active"
        ON_HOLD = "ON_HOLD", "On hold"
        COMPLETED = "COMPLETED", "Completed"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="care_plans")
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    goals = models.JSONField(default=list, blank=True)
    instructions = models.TextField(blank=True)
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="authored_care_plans")
    source_system = models.CharField(max_length=120, blank=True)
    external_id = models.CharField(max_length=160, blank=True)

    class Meta:
        ordering = ["-starts_on", "title"]


class EmergencyContact(TimeStampedModel):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="emergency_contacts")
    name = models.CharField(max_length=160)
    relationship = models.CharField(max_length=100)
    phone = models.CharField(max_length=32)
    email = models.EmailField(blank=True)
    priority = models.PositiveSmallIntegerField(default=1)
    authorized_for_updates = models.BooleanField(default=False)

    class Meta:
        ordering = ["priority", "name"]


class AdvanceDirective(TimeStampedModel):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="advance_directives")
    directive_type = models.CharField(max_length=160)
    summary = models.TextField()
    document = models.FileField(upload_to="advance-directives/", validators=[validate_clinical_file], blank=True)
    effective_from = models.DateField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)


class ClinicalDocument(TimeStampedModel):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="clinical_documents")
    title = models.CharField(max_length=200)
    category = models.CharField(max_length=100)
    file = models.FileField(upload_to="clinical-documents/", validators=[validate_clinical_file])
    checksum_sha256 = models.CharField(max_length=64, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    retention_until = models.DateField(null=True, blank=True)
    source_system = models.CharField(max_length=120, blank=True)

    def save(self, *args, **kwargs):
        if self.file and not self.checksum_sha256:
            position = self.file.tell()
            self.file.seek(0)
            self.checksum_sha256 = hashlib.sha256(self.file.read()).hexdigest()
            self.file.seek(position)
        super().save(*args, **kwargs)


class WoundRecord(TimeStampedModel):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="wound_records")
    location = models.CharField(max_length=160)
    description = models.TextField()
    length_cm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    width_cm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    photo = models.ImageField(upload_to="wound-records/", validators=[validate_clinical_file], blank=True)
    recorded_at = models.DateTimeField()
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        ordering = ["-recorded_at"]


class VitalThreshold(TimeStampedModel):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="vital_thresholds")
    vital_type = models.CharField(max_length=24, choices=VitalRecord.Type.choices)
    minimum = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    maximum = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    secondary_minimum = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    secondary_maximum = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    severity = models.CharField(max_length=12, choices=[("WARNING", "Warning"), ("CRITICAL", "Critical")], default="WARNING")
    consecutive_readings = models.PositiveSmallIntegerField(default=1)
    active = models.BooleanField(default=True)
    configured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["patient", "vital_type"], name="unique_patient_vital_threshold")]


class MealDefinition(TimeStampedModel):
    class MealType(models.TextChoices):
        BREAKFAST = "BREAKFAST", "Breakfast"
        LUNCH = "LUNCH", "Lunch"
        DINNER = "DINNER", "Dinner"
        SNACK = "SNACK", "Snack"
        HYDRATION = "HYDRATION", "Hydration"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="meal_definitions")
    name = models.CharField(max_length=160)
    meal_type = models.CharField(max_length=24, choices=MealType.choices, default=MealType.LUNCH)
    instructions = models.TextField(blank=True, help_text="Recipe and cooking instructions, dietary restrictions")
    ingredients = models.JSONField(default=list, blank=True)
    dietary_tags = models.JSONField(default=list, blank=True)
    target_time = models.TimeField(null=True, blank=True)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="created_meals")

    class Meta:
        ordering = ["target_time", "name"]

    def __str__(self):
        return f"{self.patient} · {self.get_meal_type_display()}: {self.name}"


class FoodIntakeLog(TimeStampedModel):
    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="food_intake_logs")
    meal_definition = models.ForeignKey(
        MealDefinition, on_delete=models.SET_NULL, null=True, blank=True, related_name="intake_logs"
    )
    meal_type = models.CharField(max_length=24, choices=MealDefinition.MealType.choices, default=MealDefinition.MealType.LUNCH)
    meal_name = models.CharField(max_length=160)
    portion_consumed = models.PositiveSmallIntegerField(
        default=100,
        help_text="Percentage consumed (0-100%)",
    )
    recorded_at = models.DateTimeField(db_index=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="recorded_intakes")
    notes = models.TextField(blank=True)
    client_reference = models.UUIDField(null=True, blank=True, unique=True)
    provenance = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-recorded_at"]

    def __str__(self):
        return f"{self.patient} · {self.meal_name} ({self.portion_consumed}%) at {self.recorded_at}"
