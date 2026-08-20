from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, User
from apps.safety.models import EscalationPolicy, EscalationStep


class EscalationScopingTests(APITestCase):
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

        self.policy1 = EscalationPolicy.objects.create(name="Policy 1", organization=self.org1)
        self.policy2 = EscalationPolicy.objects.create(name="Policy 2", organization=self.org2)

        self.step1 = EscalationStep.objects.create(
            policy=self.policy1,
            level=1,
            delay_minutes=5,
            channel=EscalationStep.Channel.PUSH,
        )
        self.step2 = EscalationStep.objects.create(
            policy=self.policy2,
            level=1,
            delay_minutes=5,
            channel=EscalationStep.Channel.SMS,
        )

    def test_cannot_create_step_for_foreign_policy(self):
        self.client.force_authenticate(user=self.admin1)

        resp = self.client.post(
            "/api/v1/escalation-steps/",
            {
                "policy": self.policy2.id,
                "level": 2,
                "delay_minutes": 10,
                "channel": "PUSH",
            },
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_view_or_update_foreign_step(self):
        self.client.force_authenticate(user=self.admin1)

        # GET foreign step
        resp = self.client.get(
            f"/api/v1/escalation-steps/{self.step2.id}/",
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

        # PATCH foreign step
        resp_patch = self.client.patch(
            f"/api/v1/escalation-steps/{self.step2.id}/",
            {"delay_minutes": 15},
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
            format="json",
        )
        self.assertEqual(resp_patch.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_can_create_and_update_own_step(self):
        self.client.force_authenticate(user=self.admin1)

        # Create step in own policy
        resp = self.client.post(
            "/api/v1/escalation-steps/",
            {
                "policy": self.policy1.id,
                "level": 2,
                "delay_minutes": 15,
                "channel": "SMS",
            },
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

        # Update step
        step_id = resp.data["id"]
        resp_update = self.client.patch(
            f"/api/v1/escalation-steps/{step_id}/",
            {"delay_minutes": 20},
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
            format="json",
        )
        self.assertEqual(resp_update.status_code, status.HTTP_200_OK)
        self.assertEqual(resp_update.data["delay_minutes"], 20)

    def test_caregiver_cannot_manage_escalation_steps(self):
        self.client.force_authenticate(user=self.caregiver1)

        resp = self.client.get(
            "/api/v1/escalation-steps/",
            HTTP_X_ORGANIZATION_ID=str(self.org1.id),
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
