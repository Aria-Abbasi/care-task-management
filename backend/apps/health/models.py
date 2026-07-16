from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

from apps.common.models import TimeStampedModel
from apps.patients.models import Patient


class VitalRecord(TimeStampedModel):
    class Type(models.TextChoices):
        BLOOD_PRESSURE = "BLOOD_PRESSURE", "Blood pressure"
        HEART_RATE = "HEART_RATE", "Heart rate"
        OXYGEN = "OXYGEN", "Oxygen saturation"
        TEMPERATURE = "TEMPERATURE", "Temperature"
        WEIGHT = "WEIGHT", "Weight"
        GLUCOSE = "GLUCOSE", "Blood glucose"

    patient = models.ForeignKey(Patient, on_delete=models.CASCADE, related_name="vital_records")
    type = models.CharField(max_length=24, choices=Type.choices, db_index=True)
    value = models.DecimalField(max_digits=8, decimal_places=2, validators=[MinValueValidator(0)])
    secondary_value = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        validators=[MinValueValidator(0)],
        null=True,
        blank=True,
        help_text="Diastolic value for blood pressure",
    )
    unit = models.CharField(max_length=24)
    recorded_at = models.DateTimeField(db_index=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="recorded_vitals")
    note = models.TextField(blank=True)
    client_reference = models.UUIDField(null=True, blank=True, unique=True)

    class Meta:
        ordering = ["-recorded_at"]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.type == self.Type.BLOOD_PRESSURE and self.secondary_value is None:
            raise ValidationError({"secondary_value": "Diastolic pressure is required for blood pressure."})

    def __str__(self):
        secondary = f"/{self.secondary_value:g}" if self.secondary_value is not None else ""
        return f"{self.patient} · {self.get_type_display()}: {self.value:g}{secondary} {self.unit}"
