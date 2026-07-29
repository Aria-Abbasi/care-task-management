from datetime import date, timedelta

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, SessionToken, User
from apps.accounts.security import totp_code
from apps.clinical.models import Allergy, VitalThreshold
from apps.communications.models import Conversation
from apps.health.models import VitalRecord
from apps.medications.models import DoseLog, Medication
from apps.patients.models import CareAssignment, Patient
from apps.safety.models import CareNotification, NotificationDelivery


class DemoSeedTests(TestCase):
    def test_seed_is_idempotent_with_required_patient_organization(self):
        call_command("seed_demo", verbosity=0)
        call_command("seed_demo", verbosity=0)

        organization = Organization.objects.get(slug="haven-demo")
        self.assertFalse(Patient.objects.filter(organization__isnull=True).exists())
        self.assertEqual(Patient.objects.filter(first_name="Hassan", last_name="Abbasi").count(), 1)
        self.assertEqual(Patient.objects.filter(first_name="Maryam", last_name="Abbasi").count(), 1)
        self.assertEqual(Patient.objects.filter(organization=organization).count(), 2)


class ProductionFeatureTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Haven North", slug="haven-north", timezone="Asia/Tehran")
        self.other_organization = Organization.objects.create(name="Other Care", slug="other-care")
        self.user = User.objects.create_user(
            username="caregiver",
            email="caregiver@example.com",
            password="Strong-pass-123",
            role=User.Role.CAREGIVER,
            organization=self.organization,
            phone="+15551234567",
        )
        self.doctor = User.objects.create_user(
            username="doctor",
            email="doctor@example.com",
            password="Strong-pass-123",
            role=User.Role.DOCTOR,
            organization=self.organization,
        )
        self.patient = Patient.objects.create(
            first_name="Hassan",
            last_name="Abbasi",
            birth_date=date(1944, 3, 12),
            gender=Patient.Gender.MALE,
            organization=self.organization,
        )
        self.other_patient = Patient.objects.create(
            first_name="Private",
            last_name="Patient",
            birth_date=date(1950, 1, 1),
            organization=self.other_organization,
        )
        CareAssignment.objects.create(user=self.user, patient=self.patient, relationship=CareAssignment.Relationship.CAREGIVER)
        CareAssignment.objects.create(user=self.doctor, patient=self.patient, relationship=CareAssignment.Relationship.DOCTOR)

    def authenticate(self, user=None):
        self.client.force_authenticate(user=user or self.user)

    def test_frontend_api_contract_paths_resolve(self):
        paths = [
            "/api/v1/assignments/",
            "/api/v1/tasks/",
            "/api/v1/task-templates/",
            "/api/v1/occurrences/1/complete/",
            "/api/v1/occurrences/1/completion-photo/",
            "/api/v1/occurrences/1/delay/",
            "/api/v1/occurrences/1/skip/",
            "/api/v1/medications/1/prn-dose/",
            "/api/v1/medications/barcode/",
            "/api/v1/conversations/",
            "/api/v1/messages/1/attachment/",
            "/api/v1/clinical-documents/1/download/",
            "/api/v1/shift-assignments/1/check_in/",
            "/api/v1/push-subscriptions/",
            "/api/v1/mfa/disable/",
            "/api/v1/sessions/1/revoke/",
        ]
        for path in paths:
            with self.subTest(path=path):
                self.assertIsNotNone(resolve(path))

    def test_login_issues_expiring_rotatable_and_revocable_session(self):
        response = self.client.post("/api/v1/auth/login/", {"login": self.user.email, "password": "Strong-pass-123"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("expires_at", response.data)
        token = response.data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        rotated = self.client.post("/api/v1/auth/rotate/", {}, format="json")
        self.assertEqual(rotated.status_code, 200)
        self.assertNotEqual(rotated.data["token"], token)
        self.assertFalse(SessionToken.objects.get(key_hash=SessionToken.digest(token)).active)

    def test_mfa_is_required_after_confirmation(self):
        self.authenticate()
        setup = self.client.post("/api/v1/mfa/setup/", {}, format="json")
        code = totp_code(setup.data["secret"])
        self.assertEqual(self.client.post("/api/v1/mfa/confirm/", {"code": code}, format="json").status_code, 200)
        self.client.force_authenticate(user=None)
        rejected = self.client.post("/api/v1/auth/login/", {"login": self.user.email, "password": "Strong-pass-123"}, format="json")
        accepted = self.client.post(
            "/api/v1/auth/login/",
            {"login": self.user.email, "password": "Strong-pass-123", "mfa_code": totp_code(setup.data["secret"])},
            format="json",
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(accepted.status_code, 200)

    def test_organization_and_assignment_isolate_patient_data(self):
        self.authenticate()
        response = self.client.get("/api/v1/patients/")
        self.assertEqual([item["id"] for item in response.data["results"]], [self.patient.id])
        self.assertEqual(self.client.get(f"/api/v1/fhir/Patient/{self.other_patient.id}/").status_code, 404)

    @override_settings(HAVEN_VAPID_PUBLIC_KEY="public-test-key")
    def test_push_config_and_server_backed_preferences(self):
        self.authenticate()
        self.assertTrue(self.client.get("/api/v1/push-subscriptions/config/").data["configured"])
        response = self.client.patch(
            "/api/v1/notification-preferences/me/",
            {
                "sms_enabled": True,
                "voice_enabled": True,
                "quiet_hours_start": "22:00",
                "quiet_hours_end": "06:00",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["voice_enabled"])
        self.assertEqual(response.data["quiet_hours_start"], "22:00:00")

    def test_web_push_receipt_marks_delivery_delivered(self):
        notification = CareNotification.objects.create(
            recipient=self.user,
            patient=self.patient,
            kind=CareNotification.Kind.DOSE_OVERDUE,
            severity=CareNotification.Severity.CRITICAL,
            title="Dose overdue",
            message="Review",
            source_type="dose",
            source_id="1",
            due_at=timezone.now(),
        )
        delivery = NotificationDelivery.objects.create(notification=notification, channel="PUSH")
        response = self.client.post("/api/v1/delivery-receipts/web-push/", {"receipt": str(delivery.receipt_token)}, format="json")
        delivery.refresh_from_db()
        self.assertEqual(response.status_code, 204)
        self.assertEqual(delivery.status, NotificationDelivery.Status.DELIVERED)

    def test_acknowledgement_cancels_pending_external_escalation(self):
        notification = CareNotification.objects.create(
            recipient=self.user,
            patient=self.patient,
            kind=CareNotification.Kind.TASK_OVERDUE,
            severity=CareNotification.Severity.CRITICAL,
            title="Care overdue",
            message="Review",
            source_type="occurrence",
            source_id="cancel-test",
            due_at=timezone.now(),
        )
        delivery = NotificationDelivery.objects.create(notification=notification, channel="SMS", next_attempt_at=timezone.now())
        self.authenticate()
        self.assertEqual(self.client.post(f"/api/v1/notifications/{notification.id}/acknowledge/", {}, format="json").status_code, 200)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, NotificationDelivery.Status.SUPPRESSED)

    def test_family_account_cannot_administer_medication(self):
        family = User.objects.create_user(
            username="family",
            email="family@example.com",
            password="Strong-pass-123",
            role=User.Role.FAMILY,
            organization=self.organization,
        )
        CareAssignment.objects.create(user=family, patient=self.patient, relationship=CareAssignment.Relationship.FAMILY)
        medication = Medication.objects.create(patient=self.patient, name="Safe med", dose=1, unit="tablet")
        dose = DoseLog.objects.create(medication=medication, scheduled_at=timezone.now())
        self.authenticate(family)
        response = self.client.post(
            f"/api/v1/dose-logs/{dose.id}/administer/",
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
        self.assertEqual(response.status_code, 403)

    def test_clinician_threshold_creates_non_diagnostic_alert(self):
        VitalThreshold.objects.create(
            patient=self.patient,
            vital_type=VitalRecord.Type.OXYGEN,
            minimum=92,
            severity="CRITICAL",
            consecutive_readings=1,
            configured_by=self.doctor,
        )
        self.authenticate()
        response = self.client.post(
            "/api/v1/vitals/",
            {
                "patient": self.patient.id,
                "type": "OXYGEN",
                "value": "88",
                "unit": "%",
                "recorded_at": timezone.now().isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        alert = CareNotification.objects.get(recipient=self.user, kind=CareNotification.Kind.VITAL_ALERT)
        self.assertIn("has not made a diagnosis", alert.message)

    def test_allergy_blocks_matching_medication_order(self):
        Allergy.objects.create(patient=self.patient, substance="Penicillin", severity="SEVERE", recorded_by=self.doctor)
        self.authenticate(self.doctor)
        response = self.client.post(
            "/api/v1/medications/",
            {
                "patient": self.patient.id,
                "name": "Penicillin",
                "dose": "250",
                "unit": "mg",
                "route": "Oral",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("allergy", str(response.data).lower())

    def test_prn_maximum_daily_dose_is_enforced(self):
        medication = Medication.objects.create(
            patient=self.patient,
            name="Acetaminophen",
            dose=500,
            unit="mg",
            route="Oral",
            is_prn=True,
            prn_reason="Pain",
            max_daily_doses=1,
        )
        DoseLog.objects.create(
            medication=medication,
            scheduled_at=timezone.now() - timedelta(hours=1),
            status=DoseLog.Status.GIVEN,
            administered_at=timezone.now() - timedelta(hours=1),
            administered_by=self.user,
        )
        self.authenticate()
        response = self.client.post(
            f"/api/v1/medications/{medication.id}/prn-dose/",
            {
                "verified_patient": True,
                "verified_medication": True,
                "verified_dose": True,
                "verified_route": True,
                "verified_time": True,
                "note": "Pain score 7",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("maximum", str(response.data).lower())

    def test_patient_conversation_persists_message_and_read_receipt(self):
        conversation = Conversation.objects.create(
            patient=self.patient, title="Care team", kind=Conversation.Kind.CLINICAL, created_by=self.doctor
        )
        conversation.participants.add(self.user, self.doctor)
        self.authenticate()
        sent = self.client.post(
            "/api/v1/messages/", {"conversation": conversation.id, "body": "Patient ate breakfast", "clinical": True}, format="json"
        )
        self.assertEqual(sent.status_code, 201)
        self.authenticate(self.doctor)
        read = self.client.post(f"/api/v1/messages/{sent.data['id']}/read/", {}, format="json")
        self.assertEqual(read.status_code, 200)

    def test_fhir_bundle_contains_scoped_standard_resources(self):
        VitalRecord.objects.create(
            patient=self.patient,
            type=VitalRecord.Type.HEART_RATE,
            value=72,
            unit="bpm",
            recorded_at=timezone.now(),
            recorded_by=self.user,
            source_system="Imported EHR",
        )
        self.authenticate()
        response = self.client.get(f"/api/v1/fhir/Observation/?patient={self.patient.id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["resourceType"], "Bundle")
        self.assertEqual(response.data["entry"][0]["resource"]["resourceType"], "Observation")
