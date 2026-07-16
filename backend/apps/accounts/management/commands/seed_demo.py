from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import User
from apps.care_tasks.models import Task, TaskOccurrence, TaskSchedule
from apps.health.models import VitalRecord
from apps.medications.models import Medication, MedicationSchedule
from apps.patients.models import CareAssignment, Patient


class Command(BaseCommand):
    help = "Create an idempotent local demo workspace"

    def handle(self, *args, **options):
        caregiver, created = User.objects.get_or_create(
            username="sarah",
            defaults={
                "email": "sarah@havencare.com",
                "first_name": "Sarah",
                "last_name": "James",
                "role": User.Role.CAREGIVER,
            },
        )
        if created:
            caregiver.set_password("caregiver")
            caregiver.save(update_fields=["password"])

        patient, _ = Patient.objects.get_or_create(
            first_name="Hassan",
            last_name="Abbasi",
            defaults={
                "birth_date": date(1944, 3, 12),
                "gender": Patient.Gender.MALE,
                "room": "204",
                "medical_notes": "Low-sodium diet. Monitor blood pressure twice daily.",
            },
        )
        CareAssignment.objects.get_or_create(
            user=caregiver,
            patient=patient,
            defaults={"relationship": CareAssignment.Relationship.PRIMARY_CAREGIVER},
        )

        local_date = timezone.localdate()
        task_specs = [
            ("Morning medication", Task.Category.MEDICATION, time(8, 0), "Give Amlodipine after breakfast."),
            ("Blood pressure check", Task.Category.HEALTH, time(9, 30), "Rest for five minutes before measuring."),
            ("Lunch", Task.Category.MEAL, time(12, 30), "Serve the planned low-sodium meal."),
            ("Afternoon walk", Task.Category.ACTIVITY, time(14, 0), "Twenty-minute garden route, weather permitting."),
        ]
        for title, category, scheduled_time, instructions in task_specs:
            task, _ = Task.objects.get_or_create(
                patient=patient,
                title=title,
                defaults={
                    "category": category,
                    "instructions": instructions,
                    "assigned_to": caregiver,
                },
            )
            schedule, _ = TaskSchedule.objects.get_or_create(
                task=task,
                time=scheduled_time,
                defaults={"frequency": TaskSchedule.Frequency.DAILY},
            )
            scheduled_at = timezone.make_aware(datetime.combine(local_date, scheduled_time), timezone.get_current_timezone())
            TaskOccurrence.objects.get_or_create(task=task, scheduled_at=scheduled_at, defaults={"schedule": schedule})

        medications = [
            ("Amlodipine", Decimal("5"), "mg", [time(8), time(20)], "Give after food."),
            ("Metformin", Decimal("500"), "mg", [time(16)], "Give after a meal."),
        ]
        for name, dose, unit, schedule_times, instructions in medications:
            medication, _ = Medication.objects.get_or_create(
                patient=patient,
                name=name,
                defaults={"dose": dose, "unit": unit, "instructions": instructions, "stock_quantity": 24},
            )
            for scheduled_time in schedule_times:
                MedicationSchedule.objects.get_or_create(medication=medication, time=scheduled_time)

        vital_time = timezone.make_aware(
            datetime.combine(local_date, time(9, 42)),
            timezone.get_current_timezone(),
        )
        vital_specs = [
            (VitalRecord.Type.BLOOD_PRESSURE, Decimal("120"), Decimal("80"), "mmHg"),
            (VitalRecord.Type.OXYGEN, Decimal("97"), None, "%"),
            (VitalRecord.Type.TEMPERATURE, Decimal("36.7"), None, "°C"),
            (VitalRecord.Type.WEIGHT, Decimal("72.4"), None, "kg"),
        ]
        for index, (vital_type, value, secondary, unit) in enumerate(vital_specs):
            VitalRecord.objects.get_or_create(
                patient=patient,
                type=vital_type,
                recorded_at=vital_time - timedelta(minutes=index),
                defaults={
                    "value": value,
                    "secondary_value": secondary,
                    "unit": unit,
                    "recorded_by": caregiver,
                },
            )

        self.stdout.write(self.style.SUCCESS("Demo workspace ready: sarah / caregiver"))
