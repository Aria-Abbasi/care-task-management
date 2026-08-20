from datetime import date
from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, User
from apps.medications.models import DoseLog, Medication
from apps.patients.models import CareAssignment, Patient


class MedicationApprovalAndCorrectionTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Haven Health", slug="haven-health")

        self.doctor = User.objects.create_user(
            username="doc1",
            email="doc1@example.com",
            password="StrongPassword123!",
            role=User.Role.DOCTOR,
            organization=self.org,
        )
        self.caregiver = User.objects.create_user(
            username="caregiver1",
            email="caregiver1@example.com",
            password="StrongPassword123!",
            role=User.Role.CAREGIVER,
            organization=self.org,
        )

        self.patient1 = Patient.objects.create(
            first_name="Alice",
            last_name="Smith",
            birth_date=date(1955, 3, 10),
            gender=Patient.Gender.FEMALE,
            organization=self.org,
        )
        self.patient2 = Patient.objects.create(
            first_name="Bob",
            last_name="Jones",
            birth_date=date(1960, 4, 12),
            gender=Patient.Gender.MALE,
            organization=self.org,
        )

        CareAssignment.objects.create(patient=self.patient1, user=self.caregiver, active=True, relationship="Caregiver")
        CareAssignment.objects.create(patient=self.patient1, user=self.doctor, active=True, relationship="Doctor")
        CareAssignment.objects.create(patient=self.patient2, user=self.doctor, active=True, relationship="Doctor")

        # Unapproved medication
        self.unapproved_med = Medication.objects.create(
            patient=self.patient1,
            name="Experimental Med",
            dose=Decimal("10.00"),
            unit="mg",
            route="ORAL",
            approval_status=Medication.ApprovalStatus.PENDING,
            stock_quantity=50,
        )
        self.dose_unapproved = DoseLog.objects.create(
            medication=self.unapproved_med,
            scheduled_at=timezone.now(),
            status=DoseLog.Status.SCHEDULED,
        )

        # Approved medication
        self.approved_med = Medication.objects.create(
            patient=self.patient1,
            name="Approved Med",
            dose=Decimal("20.00"),
            unit="mg",
            route="ORAL",
            approval_status=Medication.ApprovalStatus.APPROVED,
            approved_by=self.doctor,
            approved_at=timezone.now(),
            stock_quantity=50,
        )
        self.dose_approved = DoseLog.objects.create(
            medication=self.approved_med,
            scheduled_at=timezone.now(),
            status=DoseLog.Status.SCHEDULED,
        )

    def test_cannot_administer_or_correct_unapproved_medication(self):
        self.client.force_authenticate(user=self.caregiver)

        # 1. Administer attempt fails
        resp_administer = self.client.post(
            f"/api/v1/dose-logs/{self.dose_unapproved.id}/administer/",
            {
                "expected_version": self.dose_unapproved.version,
                "verified_patient": True,
                "verified_medication": True,
                "verified_dose": True,
                "verified_route": True,
                "verified_time": True,
            },
            format="json",
        )
        self.assertEqual(resp_administer.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not clinically approved", str(resp_administer.data))

        # 2. Outcome attempt fails
        resp_outcome = self.client.post(
            f"/api/v1/dose-logs/{self.dose_unapproved.id}/outcome/",
            {
                "expected_version": self.dose_unapproved.version,
                "status": DoseLog.Status.MISSED,
                "reason": "Patient sleeping",
            },
            format="json",
        )
        self.assertEqual(resp_outcome.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not clinically approved", str(resp_outcome.data))

        # 3. Correction attempt fails
        resp_correct = self.client.post(
            f"/api/v1/dose-logs/{self.dose_unapproved.id}/correct/",
            {
                "expected_version": self.dose_unapproved.version,
                "corrected_status": DoseLog.Status.HELD,
                "reason": "Order unapproved",
            },
            format="json",
        )
        self.assertEqual(resp_correct.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not clinically approved", str(resp_correct.data))

    def test_approved_medication_correction_workflow(self):
        self.client.force_authenticate(user=self.caregiver)

        # 1. Administer approved dose
        resp_administer = self.client.post(
            f"/api/v1/dose-logs/{self.dose_approved.id}/administer/",
            {
                "expected_version": self.dose_approved.version,
                "verified_patient": True,
                "verified_medication": True,
                "verified_dose": True,
                "verified_route": True,
                "verified_time": True,
            },
            format="json",
        )
        self.assertEqual(resp_administer.status_code, status.HTTP_200_OK)

        self.dose_approved.refresh_from_db()
        self.assertEqual(self.dose_approved.status, DoseLog.Status.GIVEN)

        # 2. Correct dose outcome
        resp_correct = self.client.post(
            f"/api/v1/dose-logs/{self.dose_approved.id}/correct/",
            {
                "expected_version": self.dose_approved.version,
                "corrected_status": DoseLog.Status.REFUSED,
                "reason": "Patient spat out pill",
            },
            format="json",
        )
        self.assertEqual(resp_correct.status_code, status.HTTP_200_OK)
        self.dose_approved.refresh_from_db()
        self.assertEqual(self.dose_approved.status, DoseLog.Status.REFUSED)

    def test_cannot_move_medication_to_another_patient(self):
        self.client.force_authenticate(user=self.doctor)

        resp = self.client.patch(
            f"/api/v1/medications/{self.approved_med.id}/",
            {"patient": self.patient2.id},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("patient", resp.data)

        self.approved_med.refresh_from_db()
        self.assertEqual(self.approved_med.patient_id, self.patient1.id)
