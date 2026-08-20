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
            "/api/v1/auth/change-password/",
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
        self.assertTrue(setup.data["qr_code_data_url"].startswith("data:image/png;base64,"))
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

    def test_signed_in_password_change_preserves_current_session_and_revokes_others(self):
        login = self.client.post("/api/v1/auth/login/", {"login": self.user.email, "password": "Strong-pass-123"}, format="json")
        current_token = login.data["token"]
        _, other_session = SessionToken.issue(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {current_token}")
        response = self.client.post(
            "/api/v1/auth/change-password/",
            {"current_password": "Strong-pass-123", "new_password": "Different-pass-456", "confirm_password": "Different-pass-456"},
            format="json",
        )
        self.assertEqual(response.status_code, 204)
        self.assertTrue(SessionToken.objects.get(key_hash=SessionToken.digest(current_token)).active)
        self.assertFalse(SessionToken.objects.get(pk=other_session.pk).active)
        self.client.credentials()
        self.assertEqual(
            self.client.post("/api/v1/auth/login/", {"login": self.user.email, "password": "Strong-pass-123"}, format="json").status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/auth/login/", {"login": self.user.email, "password": "Different-pass-456"}, format="json"
            ).status_code,
            200,
        )

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


class LoginThrottlingSecurityTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Test Org", slug="test-org")
        self.user1 = User.objects.create_user(
            username="user1",
            email="user1@example.com",
            password="ValidPassword123!",
            organization=self.organization,
        )
        self.user2 = User.objects.create_user(
            username="user2",
            email="user2@example.com",
            password="ValidPassword123!",
            organization=self.organization,
        )

    def test_login_rate_limiting_keys_on_client_ip_and_does_not_lock_out_other_proxy_users(self):
        # Requests come via trusted proxy 127.0.0.1 with distinct X-Forwarded-For headers
        with self.settings(HAVEN_TRUSTED_PROXIES=["127.0.0.1"]):
            # Attacker from 203.0.113.100 fails 25 times on various dummy accounts
            for i in range(25):
                resp = self.client.post(
                    "/api/v1/auth/login/",
                    {"login": f"baduser_{i}@example.com", "password": "WrongPassword!"},
                    REMOTE_ADDR="127.0.0.1",
                    HTTP_X_FORWARDED_FOR="203.0.113.100",
                    format="json",
                )
                self.assertEqual(resp.status_code, 400)

            # Attacker's IP 203.0.113.100 is now throttled
            attacker_resp = self.client.post(
                "/api/v1/auth/login/",
                {"login": self.user1.email, "password": "ValidPassword123!"},
                REMOTE_ADDR="127.0.0.1",
                HTTP_X_FORWARDED_FOR="203.0.113.100",
                format="json",
            )
            self.assertEqual(attacker_resp.status_code, 429)

            # Legitimate user from different IP 198.51.100.20 via the same proxy is NOT locked out
            legit_resp = self.client.post(
                "/api/v1/auth/login/",
                {"login": self.user1.email, "password": "ValidPassword123!"},
                REMOTE_ADDR="127.0.0.1",
                HTTP_X_FORWARDED_FOR="198.51.100.20",
                format="json",
            )
            self.assertEqual(legit_resp.status_code, 200)
            self.assertIn("token", legit_resp.data)

    def test_untrusted_direct_connection_spoofed_header_ignored(self):
        # Attacker connects directly from 198.51.100.5 (not in trusted proxies) trying to spoof different IPs
        with self.settings(HAVEN_TRUSTED_PROXIES=["127.0.0.1"]):
            for i in range(25):
                self.client.post(
                    "/api/v1/auth/login/",
                    {"login": f"baduser_{i}@example.com", "password": "WrongPassword!"},
                    REMOTE_ADDR="198.51.100.5",
                    HTTP_X_FORWARDED_FOR=f"10.0.0.{i}",
                    format="json",
                )

            # The actual REMOTE_ADDR 198.51.100.5 is throttled despite spoofed headers
            resp = self.client.post(
                "/api/v1/auth/login/",
                {"login": self.user2.email, "password": "ValidPassword123!"},
                REMOTE_ADDR="198.51.100.5",
                HTTP_X_FORWARDED_FOR="10.0.0.99",
                format="json",
            )
            self.assertEqual(resp.status_code, 429)


class TenantRoleIsolationTests(APITestCase):
    def setUp(self):
        self.org1 = Organization.objects.create(name="Hospital Alpha", slug="hospital-alpha")
        self.org2 = Organization.objects.create(name="Clinic Beta", slug="clinic-beta")

        # user_admin1 has global role ADMIN in org1, but CAREGIVER membership in org2
        self.user_admin1 = User.objects.create_user(
            username="admin_alpha",
            email="admin_alpha@example.com",
            password="StrongPassword123!",
            role=User.Role.ADMIN,
            organization=self.org1,
        )
        from apps.accounts.models import OrganizationMembership

        self.membership_admin1_in_org2 = OrganizationMembership.objects.create(
            user=self.user_admin1,
            organization=self.org2,
            role=User.Role.CAREGIVER,
            active=True,
        )

        # Patients
        self.patient_org1 = Patient.objects.create(
            first_name="Patient1",
            last_name="Alpha",
            birth_date=date(1960, 1, 1),
            gender=Patient.Gender.FEMALE,
            organization=self.org1,
        )
        self.patient_org2_unassigned = Patient.objects.create(
            first_name="Patient2",
            last_name="BetaUnassigned",
            birth_date=date(1970, 1, 1),
            gender=Patient.Gender.MALE,
            organization=self.org2,
        )
        self.patient_org2_assigned = Patient.objects.create(
            first_name="Patient3",
            last_name="BetaAssigned",
            birth_date=date(1980, 1, 1),
            gender=Patient.Gender.FEMALE,
            organization=self.org2,
        )
        CareAssignment.objects.create(
            patient=self.patient_org2_assigned,
            user=self.user_admin1,
            active=True,
            relationship="Nurse",
        )

        # Escalation policy in Org2
        from apps.safety.models import EscalationPolicy

        self.policy_org2 = EscalationPolicy.objects.create(
            name="Org2 Critical Policy",
            organization=self.org2,
        )

    def test_get_tenant_role_resolves_correctly(self):
        from apps.accounts.context import get_tenant_role

        class DummyRequest:
            def __init__(self, org_id):
                self.headers = {"X-Organization-Id": str(org_id)}

        # Default context (primary org1) -> ADMIN
        self.assertEqual(get_tenant_role(self.user_admin1), User.Role.ADMIN)

        # Org1 context -> ADMIN
        req_org1 = DummyRequest(self.org1.id)
        self.assertEqual(get_tenant_role(self.user_admin1, req_org1), User.Role.ADMIN)

        # Org2 context -> CAREGIVER (from membership)
        req_org2 = DummyRequest(self.org2.id)
        self.assertEqual(get_tenant_role(self.user_admin1, req_org2), User.Role.CAREGIVER)

    def test_admin_in_org1_cannot_act_as_admin_in_org2(self):
        # Authenticate as user_admin1
        self.client.force_authenticate(user=self.user_admin1)

        # 1. In Org 2, user is a CAREGIVER, so patient creation (admin-only) must return 403 Forbidden
        resp = self.client.post(
            "/api/v1/patients/",
            {
                "first_name": "New",
                "last_name": "Patient",
                "birth_date": "1990-01-01",
                "gender": "OTHER",
                "organization": self.org2.id,
            },
            HTTP_X_ORGANIZATION_ID=str(self.org2.id),
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

        # 2. In Org 2, listing patients should only return assigned patients, NOT unassigned patients
        resp = self.client.get(
            "/api/v1/patients/",
            HTTP_X_ORGANIZATION_ID=str(self.org2.id),
        )
        self.assertEqual(resp.status_code, 200)
        returned_ids = [p["id"] for p in resp.data["results"]]
        self.assertIn(self.patient_org2_assigned.id, returned_ids)
        self.assertNotIn(self.patient_org2_unassigned.id, returned_ids)

        # 3. In Org 2, accessing EscalationPolicyViewSet (IsCareAdmin) must return 403 Forbidden
        resp = self.client.get(
            "/api/v1/escalation-policies/",
            HTTP_X_ORGANIZATION_ID=str(self.org2.id),
        )
        self.assertEqual(resp.status_code, 403)

        # 4. In Org 2, creating task templates (admin-only) must return 403 Forbidden
        resp = self.client.post(
            "/api/v1/task-templates/",
            {
                "name": "Morning Check",
                "title": "Morning Check",
                "category": "PERSONAL_CARE",
            },
            HTTP_X_ORGANIZATION_ID=str(self.org2.id),
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

        # 5. In Org 1, user is an ADMIN, so can list escalation policies in Org 1
        from apps.safety.models import EscalationPolicy

        EscalationPolicy.objects.create(name="Org1 Policy", organization=self.org1)
        resp_org1 = self.client.get(
            "/api/v1/escalation-policies/",
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
        )
        self.assertEqual(resp_org1.status_code, 200)

        # 6. In Org 1, user can see all active Org 1 patients
        resp_patients = self.client.get(
            "/api/v1/patients/",
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
        )
        self.assertEqual(resp_patients.status_code, 200)
        p_ids = [p["id"] for p in resp_patients.data["results"]]
        self.assertIn(self.patient_org1.id, p_ids)

    def test_inactive_membership_is_ignored(self):
        from apps.accounts.context import get_active_organization_id, get_tenant_role

        # Deactivate membership in Org 2
        self.membership_admin1_in_org2.active = False
        self.membership_admin1_in_org2.save()

        class DummyRequest:
            def __init__(self, org_id):
                self.headers = {"X-Organization-Id": str(org_id)}

        req_org2 = DummyRequest(self.org2.id)
        # Should not resolve org2 active id or tenant role for deactivated membership
        self.assertEqual(get_active_organization_id(self.user_admin1, req_org2), self.org1.id)
        self.assertEqual(get_tenant_role(self.user_admin1, req_org2), User.Role.ADMIN)


class UserPasswordSecurityTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Haven Core", slug="haven-core")
        self.user = User.objects.create_user(
            username="victim_user",
            email="victim@example.com",
            password="OriginalPassword123!",
            role=User.Role.CAREGIVER,
            organization=self.org,
        )

    def test_user_cannot_change_password_via_user_patch(self):
        self.client.force_authenticate(user=self.user)
        resp = self.client.patch(
            f"/api/v1/users/{self.user.id}/",
            {"password": "HackedPassword123!"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("password", resp.data)

        # Verify original password still works
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OriginalPassword123!"))
        self.assertFalse(self.user.check_password("HackedPassword123!"))

    def test_password_change_endpoint_requires_valid_current_password(self):
        self.client.force_authenticate(user=self.user)

        # 1. Invalid current password fails
        resp_bad = self.client.post(
            "/api/v1/auth/change-password/",
            {
                "current_password": "WrongPassword123!",
                "new_password": "NewValidPassword123!",
                "confirm_password": "NewValidPassword123!",
            },
            format="json",
        )
        self.assertEqual(resp_bad.status_code, 400)
        self.assertIn("current_password", resp_bad.data)

        # 2. Valid current password succeeds
        resp_good = self.client.post(
            "/api/v1/auth/change-password/",
            {
                "current_password": "OriginalPassword123!",
                "new_password": "NewValidPassword123!",
                "confirm_password": "NewValidPassword123!",
            },
            format="json",
        )
        self.assertEqual(resp_good.status_code, 204)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewValidPassword123!"))
