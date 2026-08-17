from datetime import date
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, User
from apps.patients.models import CareAssignment, Patient
from apps.clinical.models import FoodIntakeLog, MealDefinition
from apps.safety.models import AuditEvent


class ClinicalMealTrackingTests(APITestCase):
    def setUp(self):
        self.organization = Organization.objects.create(name="Care Haven", slug="care-haven")
        self.caregiver = User.objects.create_user(
            username="caregiver_meals",
            email="caregiver_meals@example.com",
            password="safe-test-password",
            role=User.Role.CAREGIVER,
            organization=self.organization,
        )
        self.family = User.objects.create_user(
            username="family_meals",
            email="family_meals@example.com",
            password="safe-test-password",
            role=User.Role.FAMILY,
            organization=self.organization,
        )
        self.unassigned = User.objects.create_user(
            username="other_caregiver",
            email="other_caregiver@example.com",
            password="safe-test-password",
            role=User.Role.CAREGIVER,
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

    def test_caregiver_can_create_meal_definition_with_recipe_instructions(self):
        self.client.force_authenticate(self.caregiver)
        response = self.client.post(
            "/api/v1/meal-definitions/",
            {
                "patient": self.patient.id,
                "name": "Heart-Healthy Oatmeal with Berries",
                "meal_type": "BREAKFAST",
                "instructions": "Cook 1/2 cup rolled oats with 1 cup low-fat milk on low heat for 5 mins. Top with blueberries and chia seeds.",
                "ingredients": ["rolled oats", "low-fat milk", "blueberries", "chia seeds"],
                "dietary_tags": ["Low Sodium", "Heart Healthy", "High Fiber"],
                "target_time": "08:30:00",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["name"], "Heart-Healthy Oatmeal with Berries")
        self.assertEqual(response.data["meal_type"], "BREAKFAST")
        self.assertEqual(len(response.data["ingredients"]), 4)
        self.assertIn("Low Sodium", response.data["dietary_tags"])
        self.assertTrue(MealDefinition.objects.filter(patient=self.patient, name="Heart-Healthy Oatmeal with Berries").exists())

    def test_family_cannot_create_or_modify_meal_definitions(self):
        self.client.force_authenticate(self.family)
        response = self.client.post(
            "/api/v1/meal-definitions/",
            {
                "patient": self.patient.id,
                "name": "Pancakes",
                "meal_type": "BREAKFAST",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_family_can_record_food_intake_log(self):
        meal = MealDefinition.objects.create(
            patient=self.patient,
            name="Steamed Salmon and Vegetables",
            meal_type=MealDefinition.MealType.DINNER,
            instructions="Serve warm with soft steamed broccoli and carrots.",
            created_by=self.caregiver,
        )
        self.client.force_authenticate(self.family)
        response = self.client.post(
            "/api/v1/food-intake-logs/",
            {
                "patient": self.patient.id,
                "meal_definition": meal.id,
                "meal_type": "DINNER",
                "meal_name": "Steamed Salmon and Vegetables",
                "portion_consumed": 75,
                "recorded_at": timezone.now().isoformat(),
                "notes": "Ate all the salmon and most of the vegetables. Drank 200ml water.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["portion_consumed"], 75)
        self.assertEqual(response.data["recorded_by_name"], self.family.display_name)
        self.assertTrue(FoodIntakeLog.objects.filter(patient=self.patient, meal_definition=meal).exists())
        self.assertTrue(AuditEvent.objects.filter(patient=self.patient, action="FOOD_INTAKE_RECORDED").exists())

    def test_unassigned_user_cannot_access_meals_or_intake_logs(self):
        self.client.force_authenticate(self.unassigned)
        response = self.client.get(f"/api/v1/meal-definitions/?patient={self.patient.id}")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data.get("results", response.data)), 0)

        intake_response = self.client.post(
            "/api/v1/food-intake-logs/",
            {
                "patient": self.patient.id,
                "meal_name": "Snack",
                "portion_consumed": 100,
                "recorded_at": timezone.now().isoformat(),
            },
            format="json",
        )
        self.assertEqual(intake_response.status_code, status.HTTP_403_FORBIDDEN)
