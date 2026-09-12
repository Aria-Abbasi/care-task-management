from datetime import date, datetime, time, timedelta
from uuid import uuid4

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, User
from apps.communications.models import CaregiverAvailability, ShiftAssignment
from apps.health.models import VitalRecord
from apps.medications.models import DoseLog, Medication, MedicationSchedule
from apps.medications.services import generate_dose_logs_for_date
from apps.patients.models import CareAssignment, Patient
from apps.reports.models import ShiftReport
from apps.safety.models import AuditEvent, CareNotification, EscalationPolicy, EscalationStep, NotificationDelivery
from apps.safety.services import scan_overdue_alerts

from .models import AdHocTemplate, CompletionCorrection, CompletionLog, Task, TaskOccurrence, TaskSchedule
from .services import generate_occurrences_for_date, mark_overdue_occurrences


class CareApiTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Haven Test", slug="haven-test", timezone=str(timezone.get_current_timezone()))
        self.caregiver = User.objects.create_user(
            username="sarah",
            email="sarah@example.com",
            password="safe-test-password",
            role=User.Role.CAREGIVER,
            organization=self.organization,
        )
        self.patient = Patient.objects.create(
            first_name="Hassan",
            last_name="Abbasi",
            birth_date=date(1944, 3, 12),
            gender=Patient.Gender.MALE,
            organization=self.organization,
        )
        CareAssignment.objects.create(
            user=self.caregiver,
            patient=self.patient,
            relationship=CareAssignment.Relationship.PRIMARY_CAREGIVER,
        )
        self.task = Task.objects.create(
            patient=self.patient,
            title="Blood pressure check",
            category=Task.Category.HEALTH,
            assigned_to=self.caregiver,
        )
        self.schedule = TaskSchedule.objects.create(
            task=self.task,
            frequency=TaskSchedule.Frequency.DAILY,
            time=time(9, 30),
        )
        self.today = timezone.localdate()
        self.scheduled_at = timezone.make_aware(
            datetime.combine(self.today, time(9, 30)),
            timezone.get_current_timezone(),
        )
        self.occurrence = TaskOccurrence.objects.create(
            task=self.task,
            schedule=self.schedule,
            scheduled_at=self.scheduled_at,
        )

    def authenticate(self):
        self.client.force_authenticate(self.caregiver)

    def test_login_returns_token_and_user(self):
        response = self.client.post(
            "/api/v1/auth/login/",
            {"login": "sarah@example.com", "password": "safe-test-password"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("token", response.data)
        self.assertEqual(response.data["user"]["role"], User.Role.CAREGIVER)

    def test_calendar_returns_occurrences_and_coverage_for_iso_range(self):
        ShiftAssignment.objects.create(
            patient=self.patient,
            caregiver=self.caregiver,
            starts_at=self.scheduled_at - timedelta(hours=1),
            ends_at=self.scheduled_at + timedelta(hours=7),
        )
        CaregiverAvailability.objects.create(
            caregiver=self.caregiver,
            starts_at=self.scheduled_at - timedelta(hours=2),
            ends_at=self.scheduled_at + timedelta(hours=8),
            available=True,
        )
        self.authenticate()
        start = self.today.isoformat()
        end = (self.today + timedelta(days=7)).isoformat()
        response = self.client.get(f"/api/v1/patients/{self.patient.id}/calendar/?start={start}&end={end}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["start"], start)
        self.assertGreaterEqual(len(response.data["occurrences"]), 1)
        self.assertEqual(response.data["shifts"][0]["caregiver_name"], self.caregiver.display_name)
        self.assertEqual(response.data["availability"][0]["available"], True)

    def test_user_only_sees_assigned_patients(self):
        Patient.objects.create(
            first_name="Private",
            last_name="Patient",
            birth_date=date(1950, 1, 1),
            organization=self.organization,
        )
        self.authenticate()
        response = self.client.get("/api/v1/patients/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], self.patient.id)

    def test_caregiver_cannot_promote_their_own_role(self):
        self.authenticate()
        response = self.client.patch(
            f"/api/v1/users/{self.caregiver.id}/",
            {"role": User.Role.ADMIN},
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.caregiver.refresh_from_db()
        self.assertEqual(self.caregiver.role, User.Role.CAREGIVER)

    def test_task_assignee_must_share_patient_assignment(self):
        outsider = User.objects.create_user(
            username="outsider",
            email="outsider@example.com",
            password="safe-test-password",
        )
        self.authenticate()
        response = self.client.post(
            "/api/v1/tasks/",
            {
                "patient": self.patient.id,
                "title": "Private care task",
                "category": Task.Category.PERSONAL_CARE,
                "assigned_to": outsider.id,
            },
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("assigned_to", response.data)

    def test_structured_task_safety_fields_and_completion_requirements(self):
        self.authenticate()
        response = self.client.patch(
            f"/api/v1/tasks/{self.task.id}/",
            {
                "expected_outcome": "A valid reading is recorded.",
                "safety_notes": "Stop if the patient feels dizzy.",
                "equipment": ["validated monitor", "correct cuff"],
                "requires_note": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["equipment"], ["validated monitor", "correct cuff"])
        completion = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": CompletionLog.Outcome.COMPLETED, "expected_version": 1},
            format="json",
        )
        self.assertEqual(completion.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("note", completion.data)

    def test_completion_note_is_optional_when_task_policy_allows_it(self):
        self.authenticate()
        self.assertFalse(self.task.requires_note)
        response = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": CompletionLog.Outcome.COMPLETED, "expected_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], TaskOccurrence.Status.DONE)
        self.assertEqual(response.data["completion"]["note"], "")

    def test_organization_template_preserves_completion_requirements(self):
        admin = User.objects.create_user(
            username="template-policy-admin",
            email="template-policy-admin@example.com",
            password="safe-test-password",
            role=User.Role.ADMIN,
            organization=self.organization,
        )
        self.client.force_authenticate(admin)
        response = self.client.post(
            "/api/v1/task-templates/",
            {
                "name": "Documented wound care",
                "title": "Wound care",
                "category": Task.Category.HEALTH,
                "instructions": "Follow the approved wound-care plan.",
                "requires_note": True,
                "requires_photo": True,
                "schedule_defaults": {"frequency": TaskSchedule.Frequency.DAILY, "time": "09:00"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["requires_note"])
        self.assertTrue(response.data["requires_photo"])

    def test_organization_task_templates_are_admin_managed(self):
        self.authenticate()
        payload = {
            "name": "Safe hydration",
            "title": "Hydration check",
            "category": Task.Category.HEALTH,
            "priority": Task.Priority.NORMAL,
            "instructions": "Offer approved fluids.",
            "equipment": ["intake record"],
            "schedule_defaults": {"frequency": TaskSchedule.Frequency.DAILY, "time": "11:00"},
        }
        self.assertEqual(self.client.post("/api/v1/task-templates/", payload, format="json").status_code, status.HTTP_403_FORBIDDEN)
        admin = User.objects.create_user(
            username="admin-template",
            email="admin-template@example.com",
            password="safe-test-password",
            role=User.Role.ADMIN,
            organization=self.organization,
        )
        self.client.force_authenticate(admin)
        created = self.client.post("/api/v1/task-templates/", payload, format="json")
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(created.data["organization"], self.organization.id)

    def test_task_creation_generates_today_occurrence_and_prevents_replay_duplicates(self):
        self.authenticate()
        client_reference = uuid4()
        payload = {
            "client_reference": str(client_reference),
            "patient": self.patient.id,
            "title": "Evening hydration",
            "category": Task.Category.HEALTH,
            "schedules": [{"frequency": TaskSchedule.Frequency.DAILY, "time": "18:00:00"}],
        }
        first = self.client.post("/api/v1/tasks/", payload, format="json")
        replay = self.client.post("/api/v1/tasks/", payload, format="json")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        created_task = Task.objects.get(client_reference=client_reference)
        self.assertTrue(created_task.occurrences.filter(scheduled_at__date=self.today).exists())
        self.assertEqual(Task.objects.filter(client_reference=client_reference).count(), 1)

    def test_task_schedule_requires_fields_for_selected_recurrence(self):
        self.authenticate()
        response = self.client.post(
            "/api/v1/tasks/",
            {
                "patient": self.patient.id,
                "title": "Weekly mobility review",
                "category": Task.Category.ACTIVITY,
                "schedules": [{"frequency": TaskSchedule.Frequency.WEEKLY, "time": "10:00:00"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("days_of_week", str(response.data))

    def test_interval_schedule_generates_each_occurrence_for_the_day(self):
        self.occurrence.delete()
        self.schedule.delete()
        TaskSchedule.objects.create(
            task=self.task,
            frequency=TaskSchedule.Frequency.INTERVAL,
            time=time(6),
            interval_hours=6,
        )

        self.assertEqual(generate_occurrences_for_date(self.today), 3)
        self.assertEqual(
            list(self.task.occurrences.values_list("scheduled_at__hour", flat=True)),
            [6, 12, 18],
        )

    def test_task_rejects_duplicate_schedules(self):
        self.authenticate()
        schedule = {"frequency": TaskSchedule.Frequency.DAILY, "time": "12:00:00"}
        response = self.client.post(
            "/api/v1/tasks/",
            {
                "patient": self.patient.id,
                "title": "Duplicate lunch check",
                "category": Task.Category.MEAL,
                "schedules": [schedule, schedule],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("duplicate schedule", str(response.data).lower())

    def test_overdue_scanner_honors_each_schedule_completion_window(self):
        now = timezone.now()
        long_window_task = Task.objects.create(
            patient=self.patient,
            title="Long completion window",
            category=Task.Category.PERSONAL_CARE,
        )
        long_window_schedule = TaskSchedule.objects.create(
            task=long_window_task,
            frequency=TaskSchedule.Frequency.DAILY,
            time=now.time(),
            window_after_minutes=60,
        )
        still_open = TaskOccurrence.objects.create(
            task=long_window_task,
            schedule=long_window_schedule,
            scheduled_at=now - timedelta(minutes=45),
        )
        short_window_task = Task.objects.create(
            patient=self.patient,
            title="Short completion window",
            category=Task.Category.PERSONAL_CARE,
        )
        short_window_schedule = TaskSchedule.objects.create(
            task=short_window_task,
            frequency=TaskSchedule.Frequency.DAILY,
            time=now.time(),
            window_after_minutes=10,
        )
        overdue = TaskOccurrence.objects.create(
            task=short_window_task,
            schedule=short_window_schedule,
            scheduled_at=now - timedelta(minutes=20),
        )

        mark_overdue_occurrences()

        still_open.refresh_from_db()
        overdue.refresh_from_db()
        self.assertEqual(still_open.status, TaskOccurrence.Status.PENDING)
        self.assertEqual(overdue.status, TaskOccurrence.Status.MISSED)

    def test_dashboard_aggregates_daily_care(self):
        VitalRecord.objects.create(
            patient=self.patient,
            type=VitalRecord.Type.BLOOD_PRESSURE,
            value=120,
            secondary_value=80,
            unit="mmHg",
            recorded_at=timezone.now(),
            recorded_by=self.caregiver,
        )
        self.authenticate()
        response = self.client.get(f"/api/v1/patients/{self.patient.id}/dashboard/?date={self.today}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["task_summary"]["total"], 1)
        self.assertEqual(response.data["latest_vitals"][0]["type"], VitalRecord.Type.BLOOD_PRESSURE)

    def test_complete_occurrence_creates_immutable_audit_log(self):
        self.authenticate()
        response = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": CompletionLog.Outcome.COMPLETED, "note": "Reading recorded without issue.", "expected_version": 1},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.occurrence.refresh_from_db()
        self.assertEqual(self.occurrence.status, TaskOccurrence.Status.DONE)
        self.assertEqual(self.occurrence.completed_by, self.caregiver)
        self.assertTrue(CompletionLog.objects.filter(occurrence=self.occurrence).exists())

    def test_family_account_can_complete_assigned_task(self):
        family = User.objects.create_user(
            username="family-task-completer",
            email="family-task-completer@example.com",
            password="safe-test-password",
            role=User.Role.FAMILY,
            organization=self.organization,
        )
        CareAssignment.objects.create(
            user=family,
            patient=self.patient,
            relationship=CareAssignment.Relationship.FAMILY,
        )
        self.organization.allow_family_task_completion = True
        self.organization.save()
        self.client.force_authenticate(family)
        response = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": CompletionLog.Outcome.COMPLETED, "expected_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.occurrence.refresh_from_db()
        self.assertEqual(self.occurrence.status, TaskOccurrence.Status.DONE)
        self.assertEqual(self.occurrence.completed_by, family)
        self.assertTrue(CompletionLog.objects.filter(occurrence=self.occurrence, completed_by=family).exists())

    def test_family_account_cannot_complete_unassigned_patient_task(self):
        unassigned_family = User.objects.create_user(
            username="family-unassigned",
            email="family-unassigned@example.com",
            password="safe-test-password",
            role=User.Role.FAMILY,
            organization=self.organization,
        )
        self.client.force_authenticate(unassigned_family)
        response = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": CompletionLog.Outcome.COMPLETED, "expected_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_family_account_cannot_delay_skip_correct_or_create_tasks(self):
        family = User.objects.create_user(
            username="family-restricted-tester",
            email="family-restricted-tester@example.com",
            password="safe-test-password",
            role=User.Role.FAMILY,
            organization=self.organization,
        )
        CareAssignment.objects.create(
            user=family,
            patient=self.patient,
            relationship=CareAssignment.Relationship.FAMILY,
        )
        self.client.force_authenticate(family)
        actions = {
            "delay": {
                "delayed_until": (timezone.now() + timedelta(hours=1)).isoformat(),
                "reason": "Care team follow-up",
                "expected_version": 1,
            },
            "skip": {"outcome": CompletionLog.Outcome.UNABLE, "note": "Not available", "expected_version": 1},
            "correct": {
                "corrected_status": TaskOccurrence.Status.PENDING,
                "reason": "Family cannot correct care records",
                "expected_version": 1,
            },
        }

        for action, payload in actions.items():
            with self.subTest(action=action):
                response = self.client.post(
                    f"/api/v1/occurrences/{self.occurrence.id}/{action}/",
                    payload,
                    format="json",
                )
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Family cannot create tasks
        create_response = self.client.post(
            "/api/v1/tasks/",
            {
                "patient": self.patient.id,
                "title": "Family created task",
                "category": Task.Category.PERSONAL_CARE,
                "priority": Task.Priority.NORMAL,
                "instructions": "Follow up",
                "schedules": [{"frequency": TaskSchedule.Frequency.DAILY, "time": "10:00"}],
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_completion_can_be_replayed_with_same_offline_reference(self):
        self.authenticate()
        client_reference = uuid4()
        endpoint = f"/api/v1/occurrences/{self.occurrence.id}/complete/"
        payload = {"client_reference": str(client_reference), "outcome": CompletionLog.Outcome.COMPLETED, "expected_version": 1}
        first = self.client.post(endpoint, payload)
        replay = self.client.post(endpoint, payload)
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertEqual(CompletionLog.objects.filter(occurrence=self.occurrence).count(), 1)

    def test_blood_pressure_requires_diastolic_value(self):
        self.authenticate()
        response = self.client.post(
            "/api/v1/vitals/",
            {
                "patient": self.patient.id,
                "type": VitalRecord.Type.BLOOD_PRESSURE,
                "value": "120",
                "unit": "mmHg",
                "recorded_at": timezone.now().isoformat(),
            },
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("secondary_value", response.data)

    def test_vital_creation_is_idempotent_for_offline_replay(self):
        self.authenticate()
        client_reference = uuid4()
        payload = {
            "client_reference": str(client_reference),
            "patient": self.patient.id,
            "type": VitalRecord.Type.OXYGEN,
            "value": "97",
            "unit": "%",
            "recorded_at": timezone.now().isoformat(),
        }
        first = self.client.post("/api/v1/vitals/", payload, format="json")
        replay = self.client.post("/api/v1/vitals/", payload, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        self.assertEqual(VitalRecord.objects.filter(client_reference=client_reference).count(), 1)

    def test_shift_report_replay_does_not_duplicate_handover(self):
        self.authenticate()
        client_reference = uuid4()
        ended_at = timezone.now()
        payload = {
            "client_reference": str(client_reference),
            "patient": self.patient.id,
            "shift_started_at": (ended_at - timedelta(hours=8)).isoformat(),
            "shift_ended_at": ended_at.isoformat(),
            "observations": "Stable shift.",
            "status": ShiftReport.Status.SENT,
        }
        first = self.client.post("/api/v1/shift-reports/", payload, format="json")
        replay = self.client.post("/api/v1/shift-reports/", payload, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.status_code, status.HTTP_200_OK)
        report = ShiftReport.objects.get(client_reference=client_reference)
        self.assertIsNotNone(report.sent_at)
        self.assertEqual(ShiftReport.objects.filter(client_reference=client_reference).count(), 1)

    def test_occurrence_generation_is_idempotent(self):
        self.occurrence.delete()
        self.assertEqual(generate_occurrences_for_date(self.today), 1)
        self.assertEqual(generate_occurrences_for_date(self.today), 0)
        self.assertEqual(TaskOccurrence.objects.count(), 1)

    def test_caregiver_can_select_between_assigned_patients(self):
        second = Patient.objects.create(
            first_name="Maryam", last_name="Abbasi", birth_date=date(1948, 6, 4), organization=self.organization
        )
        CareAssignment.objects.create(user=self.caregiver, patient=second, relationship=CareAssignment.Relationship.CAREGIVER)
        self.authenticate()
        listing = self.client.get("/api/v1/patients/")
        dashboard = self.client.get(f"/api/v1/patients/{second.id}/dashboard/")
        self.assertEqual(listing.data["count"], 2)
        self.assertEqual(dashboard.status_code, status.HTTP_200_OK)
        self.assertEqual(dashboard.data["patient"]["id"], second.id)

    def test_stale_task_version_returns_a_conflict(self):
        self.authenticate()
        response = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": CompletionLog.Outcome.COMPLETED, "expected_version": 99},
        )
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data["code"], "version_conflict")
        self.assertEqual(int(response.data["current"]["version"]), 1)

    def test_task_correction_preserves_original_completion(self):
        self.authenticate()
        self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": CompletionLog.Outcome.COMPLETED, "expected_version": 1},
        )
        response = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/correct/",
            {
                "corrected_status": TaskOccurrence.Status.PENDING,
                "reason": "Completion was entered for the wrong time slot.",
                "expected_version": 2,
            },
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], TaskOccurrence.Status.PENDING)
        self.assertEqual(CompletionLog.objects.filter(occurrence=self.occurrence).count(), 1)
        self.assertEqual(CompletionCorrection.objects.filter(occurrence=self.occurrence).count(), 1)
        reopened = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {
                "outcome": CompletionLog.Outcome.PARTIAL,
                "note": "Care was completed after the record was reopened.",
                "expected_version": 3,
            },
        )
        self.assertEqual(reopened.status_code, status.HTTP_200_OK)
        self.assertEqual(reopened.data["outcome"], CompletionLog.Outcome.PARTIAL)
        self.assertEqual(CompletionLog.objects.filter(occurrence=self.occurrence).count(), 1)
        self.assertEqual(CompletionCorrection.objects.filter(occurrence=self.occurrence).count(), 2)

    def test_medication_administration_requires_five_rights(self):
        medication = Medication.objects.create(patient=self.patient, name="Amlodipine", dose=5, unit="mg", route="Oral", stock_quantity=10)
        dose = DoseLog.objects.create(medication=medication, scheduled_at=timezone.now())
        self.authenticate()
        endpoint = f"/api/v1/dose-logs/{dose.id}/administer/"
        unsafe = self.client.post(endpoint, {"expected_version": 1}, format="json")
        safe = self.client.post(
            endpoint,
            {
                "expected_version": 1,
                "verified_patient": True,
                "verified_medication": True,
                "verified_dose": True,
                "verified_route": True,
                "verified_time": True,
            },
            format="json",
        )
        self.assertEqual(unsafe.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(safe.status_code, status.HTTP_200_OK)
        self.assertEqual(safe.data["status"], DoseLog.Status.GIVEN)
        medication.refresh_from_db()
        self.assertEqual(medication.stock_quantity, 9)
        self.assertTrue(AuditEvent.objects.filter(action="MEDICATION_GIVEN", entity_id=str(dose.id)).exists())

    def test_late_medication_requires_an_acknowledged_reason_and_preserves_schedule(self):
        medication = Medication.objects.create(patient=self.patient, name="Metformin", dose=500, unit="mg", route="Oral", stock_quantity=10)
        scheduled_at = timezone.now() - timedelta(hours=2)
        dose = DoseLog.objects.create(medication=medication, scheduled_at=scheduled_at)
        self.authenticate()
        endpoint = f"/api/v1/dose-logs/{dose.id}/administer/"
        rights = {
            "verified_patient": True,
            "verified_medication": True,
            "verified_dose": True,
            "verified_route": True,
            "verified_time": True,
        }
        unsafe = self.client.post(endpoint, {"expected_version": 1, "administered_at": timezone.now().isoformat(), **rights}, format="json")
        self.assertEqual(unsafe.status_code, status.HTTP_400_BAD_REQUEST)
        safe = self.client.post(
            endpoint,
            {
                "expected_version": 1,
                "administered_at": timezone.now().isoformat(),
                "timing_reason": "Patient was away from the unit.",
                "timing_acknowledged": True,
                **rights,
            },
            format="json",
        )
        self.assertEqual(safe.status_code, status.HTTP_200_OK)
        self.assertEqual(safe.data["timing_status"], DoseLog.TimingStatus.LATE)
        self.assertGreater(safe.data["timing_variance_minutes"], 30)
        self.assertEqual(safe.data["timing_reason"], "Patient was away from the unit.")
        dose.refresh_from_db()
        self.assertEqual(dose.scheduled_at, scheduled_at)
        audit = AuditEvent.objects.get(action="MEDICATION_GIVEN", entity_id=str(dose.id))
        self.assertEqual(audit.metadata["timing_status"], DoseLog.TimingStatus.LATE)
        self.assertEqual(audit.metadata["timing_reason"], "Patient was away from the unit.")

    def test_early_medication_requires_an_acknowledged_reason(self):
        medication = Medication.objects.create(patient=self.patient, name="Vitamin D", dose=1, unit="tablet", route="Oral")
        scheduled_at = timezone.now() + timedelta(hours=2)
        dose = DoseLog.objects.create(medication=medication, scheduled_at=scheduled_at)
        self.authenticate()
        response = self.client.post(
            f"/api/v1/dose-logs/{dose.id}/administer/",
            {
                "expected_version": 1,
                "administered_at": timezone.now().isoformat(),
                "timing_reason": "Clinician instructed administration before transport.",
                "timing_acknowledged": True,
                "verified_patient": True,
                "verified_medication": True,
                "verified_dose": True,
                "verified_route": True,
                "verified_time": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["timing_status"], DoseLog.TimingStatus.EARLY)
        self.assertLess(response.data["timing_variance_minutes"], -30)

    def test_medication_timing_policy_controls_window_and_escalates_exception(self):
        policy = EscalationPolicy.objects.create(organization=self.organization, name="High-risk timing", active=True)
        EscalationStep.objects.create(policy=policy, level=2, channel=EscalationStep.Channel.IN_APP)
        medication = Medication.objects.create(
            patient=self.patient,
            name="Warfarin",
            dose=2,
            unit="mg",
            route="Oral",
            timing_window_minutes=15,
            timing_escalation_level=2,
            timing_escalation_policy=policy,
        )
        dose = DoseLog.objects.create(
            medication=medication,
            scheduled_at=timezone.now() - timedelta(minutes=45),
            timing_window_minutes=15,
        )
        self.authenticate()
        response = self.client.post(
            f"/api/v1/dose-logs/{dose.id}/administer/",
            {
                "expected_version": 1,
                "administered_at": timezone.now().isoformat(),
                "timing_reason": "Clinical review delayed the dose.",
                "timing_acknowledged": True,
                "verified_patient": True,
                "verified_medication": True,
                "verified_dose": True,
                "verified_route": True,
                "verified_time": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["timing_window_minutes"], 15)
        self.assertEqual(response.data["timing_status"], DoseLog.TimingStatus.LATE)
        alert = CareNotification.objects.get(kind=CareNotification.Kind.DOSE_TIMING_EXCEPTION, source_id=str(dose.id))
        self.assertEqual(alert.escalation_level, 2)
        self.assertEqual(alert.severity, CareNotification.Severity.CRITICAL)
        self.assertTrue(NotificationDelivery.objects.filter(notification=alert, channel=EscalationStep.Channel.IN_APP).exists())

    def test_overdue_care_creates_and_escalates_notification(self):
        self.occurrence.scheduled_at = timezone.now() - timedelta(hours=3)
        self.occurrence.save(update_fields=["scheduled_at", "updated_at"])
        result = scan_overdue_alerts()
        alert = CareNotification.objects.get(recipient=self.caregiver, source_id=str(self.occurrence.id))
        self.assertEqual(result["created"], 1)
        self.assertEqual(alert.severity, CareNotification.Severity.CRITICAL)
        self.assertEqual(alert.escalation_level, 3)

    def test_notification_scanner_honors_task_completion_window(self):
        self.schedule.window_after_minutes = 90
        self.schedule.save(update_fields=["window_after_minutes", "updated_at"])
        self.occurrence.scheduled_at = timezone.now() - timedelta(minutes=45)
        self.occurrence.save(update_fields=["scheduled_at", "updated_at"])

        result = scan_overdue_alerts()

        self.assertEqual(result["created"], 0)
        self.assertFalse(CareNotification.objects.filter(source_id=str(self.occurrence.id)).exists())

    def test_dose_generation_respects_order_approval_and_dates(self):
        today = timezone.localdate()
        valid = Medication.objects.create(
            patient=self.patient,
            name="Valid order",
            dose=1,
            unit="tablet",
            approval_status=Medication.ApprovalStatus.APPROVED,
            starts_on=today,
        )
        pending = Medication.objects.create(
            patient=self.patient,
            name="Pending order",
            dose=1,
            unit="tablet",
            approval_status=Medication.ApprovalStatus.PENDING,
        )
        ended = Medication.objects.create(
            patient=self.patient,
            name="Ended order",
            dose=1,
            unit="tablet",
            approval_status=Medication.ApprovalStatus.APPROVED,
            ends_on=today - timedelta(days=1),
        )
        for medication in [valid, pending, ended]:
            MedicationSchedule.objects.create(medication=medication, time=time(18))

        generate_dose_logs_for_date(today)

        self.assertTrue(DoseLog.objects.filter(medication=valid).exists())
        self.assertFalse(DoseLog.objects.filter(medication=pending).exists())
        self.assertFalse(DoseLog.objects.filter(medication=ended).exists())

    def test_on_demand_task_log_action_creates_completed_occurrence_and_audit(self):
        on_demand_task = Task.objects.create(
            patient=self.patient,
            title="Hydration Cup",
            category=Task.Category.PERSONAL_CARE,
            schedule_type=Task.ScheduleType.ON_DEMAND,
            assigned_to=self.caregiver,
        )
        self.authenticate()
        response = self.client.post(
            f"/api/v1/tasks/{on_demand_task.id}/log-action/",
            {"note": "Patient drank 250ml water", "outcome": "COMPLETED"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], TaskOccurrence.Status.DONE)
        self.assertEqual(response.data["task_detail"]["title"], "Hydration Cup")
        self.assertTrue(AuditEvent.objects.filter(action="TASK_ON_DEMAND_LOGGED", patient=self.patient).exists())

    def test_ad_hoc_task_creation_by_caregiver(self):
        self.authenticate()
        response = self.client.post(
            "/api/v1/occurrences/ad-hoc/",
            {
                "patient": self.patient.id,
                "title": "Emergency ice pack applied",
                "category": "HEALTH",
                "priority": "HIGH",
                "note": "Applied to left wrist for 15 mins",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["status"], TaskOccurrence.Status.DONE)
        self.assertEqual(response.data["task_detail"]["title"], "Emergency ice pack applied")
        created_task = Task.objects.get(title="Emergency ice pack applied")
        self.assertEqual(created_task.schedule_type, Task.ScheduleType.ON_DEMAND)
        self.assertTrue(AuditEvent.objects.filter(action="TASK_AD_HOC_CREATED", patient=self.patient).exists())

    def test_family_task_completion_toggle_enforcement(self):
        family_user = User.objects.create_user(
            username="layla_family",
            email="layla@example.com",
            password="family-password-123",
            role=User.Role.FAMILY,
            organization=self.organization,
        )
        CareAssignment.objects.create(
            user=family_user,
            patient=self.patient,
            relationship=CareAssignment.Relationship.FAMILY,
        )

        self.organization.allow_family_task_completion = False
        self.organization.save()

        self.client.force_authenticate(family_user)
        # Attempting to complete occurrence when toggle is False -> 403 Forbidden
        response = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": "COMPLETED", "note": "Assisted by family", "expected_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # Enable toggle on organization
        self.organization.allow_family_task_completion = True
        self.organization.save()

        # Now family member can complete routine task
        response = self.client.post(
            f"/api/v1/occurrences/{self.occurrence.id}/complete/",
            {"outcome": "COMPLETED", "note": "Assisted by family", "expected_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], TaskOccurrence.Status.DONE)

    def test_multi_organization_switching_and_header_scoping(self):
        from apps.accounts.models import OrganizationMembership

        other_org = Organization.objects.create(name="Haven South", slug="haven-south")
        other_patient = Patient.objects.create(
            first_name="Reza",
            last_name="Karimi",
            birth_date=date(1955, 5, 20),
            gender=Patient.Gender.MALE,
            organization=other_org,
        )

        admin_user = User.objects.create_user(
            username="super_admin",
            email="admin@example.com",
            password="admin-password-123",
            role=User.Role.ADMIN,
            organization=self.organization,
        )
        # Add membership to second organization
        OrganizationMembership.objects.create(user=admin_user, organization=other_org, role=User.Role.ADMIN)

        self.client.force_authenticate(admin_user)

        # Default header / context: scoped to Haven Test (self.organization)
        response = self.client.get("/api/v1/patients/")
        results = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        patient_ids = [p["id"] for p in results]
        self.assertIn(self.patient.id, patient_ids)
        self.assertNotIn(other_patient.id, patient_ids)

        # Passing X-Organization-Id header switches scope to other_org
        response = self.client.get("/api/v1/patients/", HTTP_X_ORGANIZATION_ID=str(other_org.id))
        scoped_results = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        scoped_patient_ids = [p["id"] for p in scoped_results]
        self.assertIn(other_patient.id, scoped_patient_ids)
        self.assertNotIn(self.patient.id, scoped_patient_ids)

    def test_suggested_quick_actions_fallback_for_new_patient(self):
        self.authenticate()
        new_patient = Patient.objects.create(
            first_name="New",
            last_name="Patient",
            birth_date=date(1960, 1, 1),
            gender=Patient.Gender.FEMALE,
            organization=self.organization,
        )
        CareAssignment.objects.create(patient=new_patient, user=self.caregiver, relationship="Primary Nurse", active=True)

        # Test morning window (hour=8)
        resp_morning = self.client.get(f"/api/v1/tasks/suggested-quick-actions/?patient={new_patient.id}&hour=8")
        self.assertEqual(resp_morning.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_morning.data["time_window"], "MORNING")
        self.assertGreaterEqual(len(resp_morning.data["suggestions"]), 3)
        self.assertTrue(any("Hydration" in s["title_en"] or "آب‌رسانی" in s["title"] for s in resp_morning.data["suggestions"]))

        # Test afternoon window (hour=14)
        resp_afternoon = self.client.get(f"/api/v1/tasks/suggested-quick-actions/?patient={new_patient.id}&hour=14")
        self.assertEqual(resp_afternoon.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_afternoon.data["time_window"], "AFTERNOON")

        # Test evening window (hour=20)
        resp_evening = self.client.get(f"/api/v1/tasks/suggested-quick-actions/?patient={new_patient.id}&hour=20")
        self.assertEqual(resp_evening.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_evening.data["time_window"], "EVENING")

        # Test night window (hour=2)
        resp_night = self.client.get(f"/api/v1/tasks/suggested-quick-actions/?patient={new_patient.id}&hour=2")
        self.assertEqual(resp_night.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_night.data["time_window"], "NIGHT")

    def test_suggested_quick_actions_ranking_by_time_window(self):
        from apps.common.timezones import patient_timezone

        self.authenticate()
        tz = patient_timezone(self.patient)
        base_date = timezone.now().astimezone(tz).date()

        # Create morning task & completions
        morning_task = Task.objects.create(
            patient=self.patient,
            title="Morning Water Assistance",
            category=Task.Category.PERSONAL_CARE,
            schedule_type=Task.ScheduleType.ON_DEMAND,
            active=True,
        )
        # Create 3 morning occurrences at 08:30 in recent days
        for i in range(1, 4):
            occ_time = timezone.make_aware(datetime.combine(base_date - timedelta(days=i), time(8, 30)), tz)
            occ = TaskOccurrence.objects.create(
                task=morning_task,
                scheduled_at=occ_time,
                status=TaskOccurrence.Status.DONE,
                completed_at=occ_time,
                completed_by=self.caregiver,
                outcome="COMPLETED",
            )
            CompletionLog.objects.create(occurrence=occ, completed_by=self.caregiver, outcome="COMPLETED", note="Drank 250ml")

        # Create night task & completions
        night_task = Task.objects.create(
            patient=self.patient,
            title="Night Repositioning Turn",
            category=Task.Category.PERSONAL_CARE,
            schedule_type=Task.ScheduleType.ON_DEMAND,
            active=True,
        )
        # Create 3 night occurrences at 23:30 in recent days
        for i in range(1, 4):
            occ_time = timezone.make_aware(datetime.combine(base_date - timedelta(days=i), time(23, 30)), tz)
            occ = TaskOccurrence.objects.create(
                task=night_task,
                scheduled_at=occ_time,
                status=TaskOccurrence.Status.DONE,
                completed_at=occ_time,
                completed_by=self.caregiver,
                outcome="COMPLETED",
            )
            CompletionLog.objects.create(occurrence=occ, completed_by=self.caregiver, outcome="COMPLETED", note="Turned to left")

        # Query morning (hour=9): Morning Water Assistance should be ranked #1
        resp_morning = self.client.get(f"/api/v1/tasks/suggested-quick-actions/?patient={self.patient.id}&hour=9")
        self.assertEqual(resp_morning.status_code, status.HTTP_200_OK)
        first_morning_sugg = resp_morning.data["suggestions"][0]
        self.assertEqual(first_morning_sugg["title"], "Morning Water Assistance")
        self.assertEqual(first_morning_sugg["time_context_count"], 3)
        self.assertEqual(first_morning_sugg["total_count"], 3)
        self.assertEqual(first_morning_sugg["id"], morning_task.id)

        # Query night (hour=23): Night Repositioning Turn should be ranked #1
        resp_night = self.client.get(f"/api/v1/tasks/suggested-quick-actions/?patient={self.patient.id}&hour=23")
        self.assertEqual(resp_night.status_code, status.HTTP_200_OK)
        first_night_sugg = resp_night.data["suggestions"][0]
        self.assertEqual(first_night_sugg["title"], "Night Repositioning Turn")
        self.assertEqual(first_night_sugg["time_context_count"], 3)

    def test_suggested_quick_actions_permission_and_patients_endpoint(self):
        self.authenticate()

        # Unassigned patient
        other_patient = Patient.objects.create(
            first_name="Unassigned",
            last_name="Patient",
            birth_date=date(1970, 1, 1),
            gender=Patient.Gender.MALE,
            organization=self.organization,
        )

        resp = self.client.get(f"/api/v1/tasks/suggested-quick-actions/?patient={other_patient.id}")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        # Test PatientViewSet action endpoint
        resp_patient_action = self.client.get(f"/api/v1/patients/{self.patient.id}/suggested-actions/?hour=10")
        self.assertEqual(resp_patient_action.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_patient_action.data["time_window"], "MORNING")
        self.assertIn("suggestions", resp_patient_action.data)


class AdHocTemplateTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(
            name="Haven Quick Care", slug="haven-quick-care", timezone=str(timezone.get_current_timezone())
        )
        self.admin = User.objects.create_user(
            username="admin_user",
            email="admin@example.com",
            password="safe-password",
            role=User.Role.ADMIN,
            organization=self.organization,
        )
        self.doctor = User.objects.create_user(
            username="doctor_user",
            email="doctor@example.com",
            password="safe-password",
            role=User.Role.DOCTOR,
            organization=self.organization,
        )
        self.caregiver = User.objects.create_user(
            username="caregiver_user",
            email="caregiver@example.com",
            password="safe-password",
            role=User.Role.CAREGIVER,
            organization=self.organization,
        )
        self.other_caregiver = User.objects.create_user(
            username="other_caregiver",
            email="other@example.com",
            password="safe-password",
            role=User.Role.CAREGIVER,
            organization=self.organization,
        )
        self.family = User.objects.create_user(
            username="family_user",
            email="family@example.com",
            password="safe-password",
            role=User.Role.FAMILY,
            organization=self.organization,
        )
        self.patient = Patient.objects.create(
            first_name="Mary",
            last_name="Smith",
            birth_date=date(1955, 4, 12),
            gender=Patient.Gender.FEMALE,
            organization=self.organization,
        )
        CareAssignment.objects.create(user=self.caregiver, patient=self.patient, relationship="CAREGIVER")
        CareAssignment.objects.create(user=self.other_caregiver, patient=self.patient, relationship="CAREGIVER")
        CareAssignment.objects.create(user=self.doctor, patient=self.patient, relationship="DOCTOR")
        CareAssignment.objects.create(user=self.family, patient=self.patient, relationship="FAMILY")

    def test_ad_hoc_template_crud_and_permissions(self):
        # Caregiver cannot create template
        self.client.force_authenticate(user=self.caregiver)
        res_cg_create = self.client.post(
            "/api/v1/ad-hoc-templates/",
            {
                "title": "Water Intake",
                "category": Task.Category.HEALTH,
                "icon": "Droplets",
            },
        )
        self.assertEqual(res_cg_create.status_code, status.HTTP_403_FORBIDDEN)

        # Admin can create template
        self.client.force_authenticate(user=self.admin)
        res_admin_create = self.client.post(
            "/api/v1/ad-hoc-templates/",
            {
                "title": "Water Intake",
                "category": Task.Category.HEALTH,
                "icon": "Droplets",
                "color": "blue",
                "default_note": "Offered water",
                "sort_order": 1,
            },
        )
        self.assertEqual(res_admin_create.status_code, status.HTTP_201_CREATED)
        template_id = res_admin_create.data["id"]

        # Doctor can update template
        self.client.force_authenticate(user=self.doctor)
        res_doc_update = self.client.patch(
            f"/api/v1/ad-hoc-templates/{template_id}/",
            {
                "default_note": "Offered 250ml water",
            },
        )
        self.assertEqual(res_doc_update.status_code, status.HTTP_200_OK)
        self.assertEqual(res_doc_update.data["default_note"], "Offered 250ml water")

        # Caregiver can list templates
        self.client.force_authenticate(user=self.caregiver)
        res_cg_list = self.client.get(f"/api/v1/ad-hoc-templates/?patient={self.patient.id}")
        self.assertEqual(res_cg_list.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_cg_list.data["results"]), 1)

        # Admin can soft-delete template
        self.client.force_authenticate(user=self.admin)
        res_del = self.client.delete(f"/api/v1/ad-hoc-templates/{template_id}/")
        self.assertEqual(res_del.status_code, status.HTTP_204_NO_CONTENT)
        tpl = AdHocTemplate.objects.get(pk=template_id)
        self.assertFalse(tpl.active)

    def test_atomic_quick_log_deduplication_and_idempotency(self):
        template = AdHocTemplate.objects.create(
            organization=self.organization,
            title="Hydration / Drinking Water",
            category=Task.Category.HEALTH,
            icon="Droplets",
            default_note="Offered water",
            sort_order=1,
            active=True,
        )

        self.client.force_authenticate(user=self.caregiver)
        ref1 = str(uuid4())

        # First tap
        res1 = self.client.post(
            f"/api/v1/ad-hoc-templates/{template.id}/log/",
            {
                "patient_id": self.patient.id,
                "client_reference": ref1,
                "note": "Drank full glass",
            },
        )
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)
        occ1_id = res1.data["id"]
        self.assertEqual(res1.data["status"], TaskOccurrence.Status.DONE)
        self.assertEqual(res1.data["outcome"], "COMPLETED")

        # Canonical task de-duplication check: exactly 1 Task created
        self.assertEqual(Task.objects.filter(patient=self.patient, schedule_type=Task.ScheduleType.ON_DEMAND).count(), 1)
        canonical_task = Task.objects.get(patient=self.patient, schedule_type=Task.ScheduleType.ON_DEMAND)
        self.assertEqual(canonical_task.title, "Hydration / Drinking Water")

        # Second tap (different event)
        ref2 = str(uuid4())
        res2 = self.client.post(
            f"/api/v1/ad-hoc-templates/{template.id}/log/",
            {
                "patient_id": self.patient.id,
                "client_reference": ref2,
            },
        )
        self.assertEqual(res2.status_code, status.HTTP_201_CREATED)
        occ2_id = res2.data["id"]
        self.assertNotEqual(occ1_id, occ2_id)

        # Still only 1 Task definition (no fragmented templates!)
        self.assertEqual(Task.objects.filter(patient=self.patient, schedule_type=Task.ScheduleType.ON_DEMAND).count(), 1)
        # But 2 occurrences
        self.assertEqual(TaskOccurrence.objects.filter(task=canonical_task).count(), 2)

        # Idempotency check: replay ref1
        res_replay = self.client.post(
            f"/api/v1/ad-hoc-templates/{template.id}/log/",
            {
                "patient_id": self.patient.id,
                "client_reference": ref1,
            },
        )
        self.assertEqual(res_replay.status_code, status.HTTP_200_OK)
        self.assertEqual(res_replay.data["id"], occ1_id)
        self.assertEqual(TaskOccurrence.objects.filter(task=canonical_task).count(), 2)

        # Check today_count in list endpoint
        res_list = self.client.get(f"/api/v1/ad-hoc-templates/?patient={self.patient.id}")
        self.assertEqual(res_list.status_code, status.HTTP_200_OK)
        self.assertEqual(res_list.data["results"][0]["today_count"], 2)

    def test_append_only_undo_and_today_count(self):
        template = AdHocTemplate.objects.create(
            organization=self.organization,
            title="Repositioning",
            category=Task.Category.PERSONAL_CARE,
            icon="RotateCw",
            sort_order=1,
            active=True,
        )
        self.client.force_authenticate(user=self.caregiver)
        res_log = self.client.post(
            f"/api/v1/ad-hoc-templates/{template.id}/log/",
            {
                "patient": self.patient.id,
            },
        )
        self.assertEqual(res_log.status_code, status.HTTP_201_CREATED)
        occ_id = res_log.data["id"]

        # Other caregiver cannot undo
        self.client.force_authenticate(user=self.other_caregiver)
        res_unauthorized_undo = self.client.post(f"/api/v1/occurrences/{occ_id}/undo/")
        self.assertEqual(res_unauthorized_undo.status_code, status.HTTP_403_FORBIDDEN)

        # Authoring caregiver undoes within grace window
        self.client.force_authenticate(user=self.caregiver)
        res_undo = self.client.post(f"/api/v1/occurrences/{occ_id}/undo/")
        self.assertEqual(res_undo.status_code, status.HTTP_200_OK)

        # Verify append-only: occurrence still exists in database!
        occ = TaskOccurrence.objects.get(pk=occ_id)
        self.assertEqual(occ.status, TaskOccurrence.Status.SKIPPED)
        self.assertIn("Undone by", occ.completion.note)

        # Verify audit event
        audit_exists = AuditEvent.objects.filter(
            action="TASK_QUICK_LOG_UNDONE",
            entity_id=str(occ_id),
        ).exists()
        self.assertTrue(audit_exists)

        # Verify today_count dropped back to 0
        res_list = self.client.get(f"/api/v1/ad-hoc-templates/?patient={self.patient.id}")
        self.assertEqual(res_list.data["results"][0]["today_count"], 0)

    def test_generic_occurrences_quick_log(self):
        template = AdHocTemplate.objects.create(
            organization=self.organization,
            title="Assisted Walk",
            category=Task.Category.ACTIVITY,
            icon="Footprints",
            sort_order=1,
            active=True,
        )
        self.client.force_authenticate(user=self.caregiver)
        res = self.client.post(
            "/api/v1/occurrences/quick-log/",
            {
                "template_id": template.id,
                "patient_id": self.patient.id,
                "note": "10 minute walk",
            },
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["task_detail"]["title"], "Assisted Walk")
        self.assertEqual(res.data["status"], TaskOccurrence.Status.DONE)

    def test_requires_note_enforcement(self):
        template = AdHocTemplate.objects.create(
            organization=self.organization,
            title="Complex Wound Check",
            category=Task.Category.HEALTH,
            icon="Activity",
            sort_order=1,
            active=True,
            requires_note=True,
        )
        self.client.force_authenticate(user=self.caregiver)

        # Logging without note should fail
        res_fail = self.client.post(
            f"/api/v1/ad-hoc-templates/{template.id}/log/",
            {
                "patient_id": self.patient.id,
            },
        )
        self.assertEqual(res_fail.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("note", res_fail.data)

        # Logging with empty note should fail
        res_fail_empty = self.client.post(
            f"/api/v1/ad-hoc-templates/{template.id}/log/",
            {
                "patient_id": self.patient.id,
                "note": "   ",
            },
        )
        self.assertEqual(res_fail_empty.status_code, status.HTTP_400_BAD_REQUEST)

        # Logging with valid note should succeed
        res_success = self.client.post(
            f"/api/v1/ad-hoc-templates/{template.id}/log/",
            {
                "patient_id": self.patient.id,
                "note": "Dressing changed, no signs of infection.",
            },
        )
        self.assertEqual(res_success.status_code, status.HTTP_201_CREATED)
