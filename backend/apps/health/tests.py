from datetime import date
from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, User
from apps.health.models import CustomVitalType
from apps.patients.models import CareAssignment, Patient


class CustomVitalTypeTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Care Clinic", slug="care-clinic")
        self.caregiver = User.objects.create_user(
            username="caregiver1",
            email="caregiver1@example.com",
            password="safe-test-password",
            role=User.Role.CAREGIVER,
            organization=self.organization,
        )
        self.doctor = User.objects.create_user(
            username="doctor1",
            email="doctor1@example.com",
            password="safe-test-password",
            role=User.Role.DOCTOR,
            organization=self.organization,
        )
        self.family = User.objects.create_user(
            username="family1",
            email="family1@example.com",
            password="safe-test-password",
            role=User.Role.FAMILY,
            organization=self.organization,
        )
        self.patient = Patient.objects.create(
            first_name="Maryam",
            last_name="Abbasi",
            birth_date=date(1954, 3, 15),
            organization=self.organization,
        )
        CareAssignment.objects.create(user=self.caregiver, patient=self.patient, relationship=CareAssignment.Relationship.PRIMARY_CAREGIVER)
        CareAssignment.objects.create(user=self.family, patient=self.patient, relationship=CareAssignment.Relationship.FAMILY)

    def test_caregiver_can_create_custom_vital_type(self):
        self.client.force_authenticate(self.caregiver)
        response = self.client.post(
            "/api/v1/vital-types/",
            {
                "name": "Peak Flow",
                "unit": "L/min",
                "description": "Expiratory peak flow measurement",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Peak Flow")
        self.assertEqual(response.data["slug"], "PEAK_FLOW")
        self.assertEqual(response.data["unit"], "L/min")
        self.assertEqual(response.data["created_by_name"], self.caregiver.display_name)
        self.assertTrue(CustomVitalType.objects.filter(slug="PEAK_FLOW", organization=self.organization).exists())

    def test_family_cannot_create_custom_vital_type(self):
        self.client.force_authenticate(self.family)
        response = self.client.post(
            "/api/v1/vital-types/",
            {"name": "Pain Level", "unit": "/10"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_create_custom_vital_type_with_empty_name_or_unit(self):
        self.client.force_authenticate(self.caregiver)
        response = self.client.post(
            "/api/v1/vital-types/",
            {"name": "   ", "unit": ""},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", response.data)

    def test_cannot_create_duplicate_custom_vital_type(self):
        self.client.force_authenticate(self.caregiver)
        self.client.post(
            "/api/v1/vital-types/",
            {"name": "Pain Level", "unit": "/10"},
            format="json",
        )
        # Attempt to create duplicate name
        response = self.client.post(
            "/api/v1/vital-types/",
            {"name": "pain level", "unit": "/10"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_create_custom_type_colliding_with_builtin(self):
        self.client.force_authenticate(self.caregiver)
        response = self.client.post(
            "/api/v1/vital-types/",
            {"name": "Blood Pressure", "unit": "mmHg"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_options_endpoint_returns_builtin_and_custom_types(self):
        CustomVitalType.objects.create(
            organization=self.organization,
            created_by=self.caregiver,
            name="Respiratory Rate",
            slug="RESPIRATORY_RATE",
            unit="breaths/min",
        )
        self.client.force_authenticate(self.caregiver)
        response = self.client.get("/api/v1/vital-types/options/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        built_in_types = [item["type"] for item in response.data["built_in"]]
        self.assertIn("BLOOD_PRESSURE", built_in_types)
        self.assertIn("OXYGEN", built_in_types)
        custom_types = [item["type"] for item in response.data["custom"]]
        self.assertIn("RESPIRATORY_RATE", custom_types)

    def test_can_record_and_retrieve_custom_vital_reading(self):
        CustomVitalType.objects.create(
            organization=self.organization,
            created_by=self.caregiver,
            name="Peak Expiratory Flow",
            slug="PEAK_EXPIRATORY_FLOW",
            unit="L/min",
        )
        self.client.force_authenticate(self.caregiver)
        record_response = self.client.post(
            "/api/v1/vitals/",
            {
                "patient": self.patient.id,
                "type": "PEAK_EXPIRATORY_FLOW",
                "value": "450.00",
                "unit": "L/min",
                "recorded_at": timezone.now().isoformat(),
                "note": "Post-inhaler check",
            },
            format="json",
        )
        self.assertEqual(record_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(record_response.data["type"], "PEAK_EXPIRATORY_FLOW")
        self.assertEqual(Decimal(record_response.data["value"]), Decimal("450.00"))

        # Retrieve readings
        get_response = self.client.get(f"/api/v1/vitals/?patient={self.patient.id}&type=PEAK_EXPIRATORY_FLOW")
        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(get_response.data["results"] if "results" in get_response.data else get_response.data), 1)

        # Retrieve patient dashboard latest_vitals
        today = timezone.localdate().isoformat()
        dash_response = self.client.get(f"/api/v1/patients/{self.patient.id}/dashboard/?date={today}")
        self.assertEqual(dash_response.status_code, status.HTTP_200_OK)
        types_in_dash = [v["type"] for v in dash_response.data["latest_vitals"]]
        self.assertIn("PEAK_EXPIRATORY_FLOW", types_in_dash)
