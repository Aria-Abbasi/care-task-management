from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, User
from apps.patients.models import CareAssignment, Patient


class PatientTenantIsolationTests(APITestCase):
    def setUp(self):
        self.org1 = Organization.objects.create(name="Hospital 1", slug="hospital-1")
        self.org2 = Organization.objects.create(name="Hospital 2", slug="hospital-2")

        self.admin1 = User.objects.create_user(
            username="admin1",
            email="admin1@example.com",
            password="StrongPassword123!",
            role=User.Role.ADMIN,
            organization=self.org1,
        )
        self.caregiver1 = User.objects.create_user(
            username="caregiver1",
            email="caregiver1@example.com",
            password="StrongPassword123!",
            role=User.Role.CAREGIVER,
            organization=self.org1,
        )
        self.user_org2 = User.objects.create_user(
            username="user_org2",
            email="user_org2@example.com",
            password="StrongPassword123!",
            role=User.Role.CAREGIVER,
            organization=self.org2,
        )

        self.patient_org1 = Patient.objects.create(
            first_name="Alice",
            last_name="Alpha",
            birth_date=date(1960, 1, 1),
            organization=self.org1,
        )
        self.patient_org2 = Patient.objects.create(
            first_name="Bob",
            last_name="Beta",
            birth_date=date(1970, 2, 2),
            organization=self.org2,
        )

        CareAssignment.objects.create(patient=self.patient_org1, user=self.caregiver1, active=True, relationship="CAREGIVER")

    def test_admin_cannot_view_or_modify_other_tenant_patients(self):
        self.client.force_authenticate(user=self.admin1)

        # GET detail of foreign patient -> 404
        resp = self.client.get(
            f"/api/v1/patients/{self.patient_org2.id}/",
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

        # PATCH foreign patient -> 404
        resp_patch = self.client.patch(
            f"/api/v1/patients/{self.patient_org2.id}/",
            {"first_name": "Tampered"},
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
            format="json",
        )
        self.assertEqual(resp_patch.status_code, status.HTTP_404_NOT_FOUND)

    def test_cannot_assign_cross_tenant_user_or_patient(self):
        self.client.force_authenticate(user=self.admin1)

        # Attempt to assign user from org2 to patient in org1
        resp = self.client.post(
            "/api/v1/assignments/",
            {
                "patient": self.patient_org1.id,
                "user": self.user_org2.id,
                "relationship": "CAREGIVER",
            },
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        # Attempt to assign user to patient in org2
        resp2 = self.client.post(
            "/api/v1/assignments/",
            {
                "patient": self.patient_org2.id,
                "user": self.caregiver1.id,
                "relationship": "CAREGIVER",
            },
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
            format="json",
        )
        self.assertEqual(resp2.status_code, status.HTTP_403_FORBIDDEN)
