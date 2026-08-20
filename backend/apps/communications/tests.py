from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import Organization, User
from apps.communications.models import Conversation, Message
from apps.patients.models import CareAssignment, Patient


class MessageImmutabilityTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Haven General", slug="haven-general")

        self.caregiver = User.objects.create_user(
            username="caregiver1",
            email="caregiver1@example.com",
            password="StrongPassword123!",
            role=User.Role.CAREGIVER,
            organization=self.org,
        )
        self.admin = User.objects.create_user(
            username="admin1",
            email="admin1@example.com",
            password="StrongPassword123!",
            role=User.Role.ADMIN,
            organization=self.org,
        )

        self.patient1 = Patient.objects.create(
            first_name="John",
            last_name="Doe",
            birth_date=date(1965, 5, 20),
            gender=Patient.Gender.MALE,
            organization=self.org,
        )
        self.patient2 = Patient.objects.create(
            first_name="Jane",
            last_name="Smith",
            birth_date=date(1975, 8, 15),
            gender=Patient.Gender.FEMALE,
            organization=self.org,
        )

        CareAssignment.objects.create(patient=self.patient1, user=self.caregiver, active=True, relationship="Caregiver")
        CareAssignment.objects.create(patient=self.patient2, user=self.caregiver, active=True, relationship="Caregiver")
        CareAssignment.objects.create(patient=self.patient1, user=self.admin, active=True, relationship="Admin")
        CareAssignment.objects.create(patient=self.patient2, user=self.admin, active=True, relationship="Admin")

        self.convo1 = Conversation.objects.create(
            patient=self.patient1,
            title="Convo Patient 1",
            kind=Conversation.Kind.CLINICAL,
            created_by=self.caregiver,
        )
        self.convo1.participants.add(self.caregiver, self.admin)

        self.convo2 = Conversation.objects.create(
            patient=self.patient2,
            title="Convo Patient 2",
            kind=Conversation.Kind.CLINICAL,
            created_by=self.caregiver,
        )
        self.convo2.participants.add(self.caregiver, self.admin)

        self.message1 = Message.objects.create(
            conversation=self.convo1,
            sender=self.caregiver,
            body="Patient 1 confidential note",
        )

    def test_cannot_move_message_to_another_conversation(self):
        self.client.force_authenticate(user=self.caregiver)

        # Attempt to reassociate message1 to convo2
        resp = self.client.patch(
            f"/api/v1/messages/{self.message1.id}/",
            {"conversation": self.convo2.id},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("conversation", resp.data)

        self.message1.refresh_from_db()
        self.assertEqual(self.message1.conversation_id, self.convo1.id)

    def test_can_edit_message_body_without_changing_conversation(self):
        self.client.force_authenticate(user=self.caregiver)

        resp = self.client.patch(
            f"/api/v1/messages/{self.message1.id}/",
            {"body": "Updated note for Patient 1"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.message1.refresh_from_db()
        self.assertEqual(self.message1.body, "Updated note for Patient 1")
        self.assertEqual(self.message1.conversation_id, self.convo1.id)

    def test_cannot_move_conversation_to_another_patient(self):
        self.client.force_authenticate(user=self.caregiver)

        resp = self.client.patch(
            f"/api/v1/conversations/{self.convo1.id}/",
            {"patient": self.patient2.id},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("patient", resp.data)

        self.convo1.refresh_from_db()
        self.assertEqual(self.convo1.patient_id, self.patient1.id)
