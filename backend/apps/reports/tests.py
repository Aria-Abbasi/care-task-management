from datetime import date

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, User
from apps.patients.models import CareAssignment, Patient
from apps.reports.models import ShiftReport


class ShiftReportTenantIsolationTests(APITestCase):
    def setUp(self):
        self.org1 = Organization.objects.create(name="Hospital 1", slug="hospital-1")
        self.org2 = Organization.objects.create(name="Hospital 2", slug="hospital-2")

        self.caregiver1 = User.objects.create_user(
            username="caregiver1",
            email="caregiver1@example.com",
            password="StrongPassword123!",
            role=User.Role.CAREGIVER,
            organization=self.org1,
        )
        self.caregiver2 = User.objects.create_user(
            username="caregiver2",
            email="caregiver2@example.com",
            password="StrongPassword123!",
            role=User.Role.CAREGIVER,
            organization=self.org2,
        )

        self.patient_org1 = Patient.objects.create(
            first_name="Patient1",
            last_name="Org1",
            birth_date=date(1960, 1, 1),
            organization=self.org1,
        )
        self.patient_org2 = Patient.objects.create(
            first_name="Patient2",
            last_name="Org2",
            birth_date=date(1970, 2, 2),
            organization=self.org2,
        )

        CareAssignment.objects.create(patient=self.patient_org1, user=self.caregiver1, active=True, relationship="CAREGIVER")
        CareAssignment.objects.create(patient=self.patient_org2, user=self.caregiver2, active=True, relationship="CAREGIVER")

        now = timezone.now()
        self.report_org1 = ShiftReport.objects.create(
            author=self.caregiver1,
            patient=self.patient_org1,
            shift_started_at=now - timezone.timedelta(hours=8),
            shift_ended_at=now,
            observations="Patient had a good day.",
        )

    def test_cross_tenant_report_isolation(self):
        self.client.force_authenticate(user=self.caregiver2)

        # Caregiver in Org2 cannot view Org1's shift report
        resp = self.client.get(f"/api/v1/shift-reports/{self.report_org1.id}/", HTTP_X_ORGANIZATION_ID=str(self.org2.id))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

        # Caregiver in Org2 cannot create report for Org1's patient
        now = timezone.now()
        resp_create = self.client.post(
            "/api/v1/shift-reports/",
            {
                "patient": self.patient_org1.id,
                "shift_started_at": (now - timezone.timedelta(hours=8)).isoformat(),
                "shift_ended_at": now.isoformat(),
                "observations": "Unauthorized shift report",
            },
            HTTP_X_ORGANIZATION_ID=str(self.org2.id),
            format="json",
        )
        self.assertEqual(resp_create.status_code, status.HTTP_403_FORBIDDEN)
