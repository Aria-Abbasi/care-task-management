from datetime import date, datetime, time, timedelta
from uuid import uuid4

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import User
from apps.health.models import VitalRecord
from apps.medications.models import DoseLog, Medication
from apps.patients.models import CareAssignment, Patient
from apps.reports.models import ShiftReport
from apps.safety.models import AuditEvent, CareNotification
from apps.safety.services import scan_overdue_alerts

from .models import CompletionCorrection, CompletionLog, Task, TaskOccurrence, TaskSchedule
from .services import generate_occurrences_for_date


class CareApiTests(APITestCase):
    def setUp(self):
        self.caregiver = User.objects.create_user(
            username="sarah",
            email="sarah@example.com",
            password="safe-test-password",
            role=User.Role.CAREGIVER,
        )
        self.patient = Patient.objects.create(
            first_name="Hassan",
            last_name="Abbasi",
            birth_date=date(1944, 3, 12),
            gender=Patient.Gender.MALE,
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

    def test_user_only_sees_assigned_patients(self):
        Patient.objects.create(
            first_name="Private",
            last_name="Patient",
            birth_date=date(1950, 1, 1),
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
        second = Patient.objects.create(first_name="Maryam", last_name="Abbasi", birth_date=date(1948, 6, 4))
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
        self.assertTrue(AuditEvent.objects.filter(action="MEDICATION_GIVEN", entity_id=str(dose.id)).exists())

    def test_overdue_care_creates_and_escalates_notification(self):
        self.occurrence.scheduled_at = timezone.now() - timedelta(hours=3)
        self.occurrence.save(update_fields=["scheduled_at", "updated_at"])
        result = scan_overdue_alerts()
        alert = CareNotification.objects.get(recipient=self.caregiver, source_id=str(self.occurrence.id))
        self.assertEqual(result["created"], 1)
        self.assertEqual(alert.severity, CareNotification.Severity.CRITICAL)
        self.assertEqual(alert.escalation_level, 3)
