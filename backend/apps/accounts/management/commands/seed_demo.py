from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import Organization, User
from apps.care_tasks.models import AdHocTemplate, Task, TaskOccurrence, TaskSchedule
from apps.clinical.models import Allergy, CarePlan, Diagnosis, EmergencyContact
from apps.communications.models import CaregiverAvailability, Conversation, Message, ShiftAssignment
from apps.health.models import VitalRecord
from apps.medications.models import Medication, MedicationSchedule
from apps.patients.models import CareAssignment, Patient
from apps.safety.models import EscalationPolicy, EscalationStep


class Command(BaseCommand):
    help = "Create an idempotent local demo workspace"

    def handle(self, *args, **options):
        organization, _ = Organization.objects.get_or_create(
            slug="haven-demo", defaults={"name": "Haven Demo Care", "country_code": "IR", "timezone": "Asia/Tehran"}
        )
        caregiver, created = User.objects.get_or_create(
            username="sarah",
            defaults={
                "email": "sarah@havencare.com",
                "first_name": "Sarah",
                "last_name": "James",
                "role": User.Role.CAREGIVER,
                "organization": organization,
            },
        )
        if created:
            caregiver.set_password("caregiver")
            caregiver.save(update_fields=["password"])
        elif caregiver.organization_id != organization.id:
            caregiver.organization = organization
            caregiver.save(update_fields=["organization"])

        doctor, doctor_created = User.objects.get_or_create(
            username="doctor",
            defaults={
                "email": "doctor@havencare.com",
                "first_name": "Nima",
                "last_name": "Rahimi",
                "role": User.Role.DOCTOR,
                "organization": organization,
            },
        )
        family, family_created = User.objects.get_or_create(
            username="layla",
            defaults={
                "email": "layla@havencare.com",
                "first_name": "Layla",
                "last_name": "Abbasi",
                "role": User.Role.FAMILY,
                "organization": organization,
            },
        )
        admin, admin_created = User.objects.get_or_create(
            username="admin",
            defaults={
                "email": "admin@havencare.com",
                "first_name": "Ava",
                "last_name": "Admin",
                "role": User.Role.ADMIN,
                "organization": organization,
            },
        )
        for user, was_created, password in [
            (doctor, doctor_created, "clinician-demo"),
            (family, family_created, "family-demo"),
            (admin, admin_created, "admin-demo"),
        ]:
            if was_created:
                user.set_password(password)
                user.save(update_fields=["password"])

        def get_demo_patient(first_name, last_name, defaults):
            patient = Patient.objects.filter(
                first_name=first_name,
                last_name=last_name,
                organization=organization,
            ).first()
            if patient:
                return patient

            # Demo databases created before organization scoping have NULL here.
            # Adopt those records instead of creating duplicates that leave existing
            # care assignments pointing at an inaccessible patient.
            patient = Patient.objects.filter(
                first_name=first_name,
                last_name=last_name,
                organization__isnull=True,
            ).first()
            if patient:
                patient.organization = organization
                patient.save(update_fields=["organization", "updated_at"])
                return patient

            return Patient.objects.create(
                first_name=first_name,
                last_name=last_name,
                organization=organization,
                **defaults,
            )

        patient = get_demo_patient(
            "Hassan",
            "Abbasi",
            {
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
        CareAssignment.objects.get_or_create(user=doctor, patient=patient, defaults={"relationship": CareAssignment.Relationship.DOCTOR})
        CareAssignment.objects.get_or_create(user=family, patient=patient, defaults={"relationship": CareAssignment.Relationship.FAMILY})
        CareAssignment.objects.get_or_create(
            user=admin, patient=patient, defaults={"relationship": CareAssignment.Relationship.ADMINISTRATOR}
        )

        second_patient = get_demo_patient(
            "Maryam",
            "Abbasi",
            {
                "birth_date": date(1948, 6, 4),
                "gender": Patient.Gender.FEMALE,
                "room": "205",
                "medical_notes": "Uses a walking aid. Encourage hydration throughout the day.",
            },
        )
        CareAssignment.objects.get_or_create(
            user=caregiver,
            patient=second_patient,
            defaults={"relationship": CareAssignment.Relationship.CAREGIVER},
        )
        CareAssignment.objects.get_or_create(
            user=admin, patient=second_patient, defaults={"relationship": CareAssignment.Relationship.ADMINISTRATOR}
        )

        Allergy.objects.get_or_create(
            patient=patient,
            substance="Penicillin",
            defaults={"reaction": "Hives", "severity": Allergy.Severity.SEVERE, "recorded_by": doctor},
        )
        Diagnosis.objects.get_or_create(
            patient=patient,
            display="Hypertension",
            defaults={"code": "38341003", "code_system": "http://snomed.info/sct", "recorded_by": doctor},
        )
        CarePlan.objects.get_or_create(
            patient=patient,
            title="Daily independence plan",
            defaults={
                "status": CarePlan.Status.ACTIVE,
                "goals": ["Maintain safe mobility", "Keep blood pressure observations current"],
                "instructions": "Support independent choices and document changes.",
                "author": doctor,
            },
        )
        EmergencyContact.objects.get_or_create(
            patient=patient,
            name="Layla Abbasi",
            defaults={"relationship": "Daughter", "phone": "+98 912 000 0000", "email": family.email, "authorized_for_updates": True},
        )

        conversation, _ = Conversation.objects.get_or_create(
            patient=patient, title="Hassan care circle", kind=Conversation.Kind.FAMILY, defaults={"created_by": caregiver}
        )
        conversation.participants.add(caregiver, family, doctor)
        Message.objects.get_or_create(conversation=conversation, sender=family, body="How did Dad sleep last night?")
        starts = timezone.now().replace(hour=15, minute=0, second=0, microsecond=0)
        if starts < timezone.now():
            starts += timedelta(days=1)
        ShiftAssignment.objects.get_or_create(
            patient=patient,
            caregiver=caregiver,
            starts_at=starts,
            defaults={"ends_at": starts + timedelta(hours=8), "notes": "Review morning observations at handover."},
        )

        policy, _ = EscalationPolicy.objects.get_or_create(
            organization=organization, name="Critical medication escalation", defaults={"is_default": True}
        )
        for level, delay, channel, roles in [
            (1, 0, "PUSH", ["CAREGIVER"]),
            (2, 10, "SMS", ["CAREGIVER", "ADMIN"]),
            (3, 20, "VOICE", ["ADMIN"]),
        ]:
            EscalationStep.objects.get_or_create(
                policy=policy, level=level, channel=channel, defaults={"delay_minutes": delay, "recipient_roles": roles}
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

        hydration, _ = Task.objects.get_or_create(
            patient=second_patient,
            title="Hydration check",
            defaults={
                "category": Task.Category.HEALTH,
                "instructions": "Offer water and record any difficulty drinking.",
                "assigned_to": caregiver,
            },
        )
        CaregiverAvailability.objects.get_or_create(
            caregiver=caregiver,
            starts_at=starts,
            ends_at=starts + timedelta(hours=8),
            defaults={"available": True, "note": "Available for scheduled care."},
        )
        hydration_schedule, _ = TaskSchedule.objects.get_or_create(
            task=hydration, time=time(11, 0), defaults={"frequency": TaskSchedule.Frequency.DAILY}
        )
        hydration_at = timezone.make_aware(datetime.combine(local_date, time(11, 0)), timezone.get_current_timezone())
        TaskOccurrence.objects.get_or_create(task=hydration, scheduled_at=hydration_at, defaults={"schedule": hydration_schedule})

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

        quick_templates = [
            ("Hydration / Drinking Water", Task.Category.HEALTH, "Droplets", "blue", 1, "Offered 200ml water; consumed well."),
            ("Repositioning", Task.Category.PERSONAL_CARE, "RotateCw", "purple", 2, "Repositioned to reduce pressure; skin intact."),
            ("Assisted Walk", Task.Category.ACTIVITY, "Footprints", "green", 3, "Assisted walking with mobility aid for 10 minutes."),
            ("Snack / Nourishment", Task.Category.MEAL, "Utensils", "amber", 4, "Provided light snack and fluids."),
        ]
        for title, category, icon, color, sort_order, default_note in quick_templates:
            AdHocTemplate.objects.get_or_create(
                organization=organization,
                title=title,
                defaults={
                    "category": category,
                    "icon": icon,
                    "color": color,
                    "sort_order": sort_order,
                    "default_note": default_note,
                    "is_quick_action": True,
                    "active": True,
                },
            )

        self.stdout.write(
            self.style.SUCCESS("Demo workspace ready: sarah/caregiver · doctor/clinician-demo · layla/family-demo · admin/admin-demo")
        )
