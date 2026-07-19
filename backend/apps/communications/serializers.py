from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import CaregiverAvailability, Conversation, Message, MessageReadReceipt, ShiftAssignment


class MessageReadReceiptSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.display_name", read_only=True)

    class Meta:
        model = MessageReadReceipt
        fields = ["user", "user_name", "read_at"]


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source="sender.display_name", read_only=True)
    read_receipts = MessageReadReceiptSerializer(many=True, read_only=True)
    attachment = serializers.SerializerMethodField()
    voice_note = serializers.SerializerMethodField()
    attachment_upload = serializers.FileField(source="attachment", write_only=True, required=False)
    voice_note_upload = serializers.FileField(source="voice_note", write_only=True, required=False)

    class Meta:
        model = Message
        fields = [
            "id",
            "conversation",
            "sender",
            "sender_name",
            "body",
            "clinical",
            "urgent",
            "attachment",
            "voice_note",
            "attachment_upload",
            "voice_note_upload",
            "mentions",
            "client_reference",
            "edited_at",
            "read_receipts",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "sender", "edited_at", "created_at", "updated_at"]

    def get_attachment(self, obj):
        return f"/api/v1/messages/{obj.id}/attachment/" if obj.attachment else ""

    def get_voice_note(self, obj):
        return f"/api/v1/messages/{obj.id}/voice-note/" if obj.voice_note else ""

    def validate(self, attrs):
        if not attrs.get("body") and not attrs.get("attachment") and not attrs.get("voice_note"):
            raise serializers.ValidationError("A message needs text, an attachment, or a voice note.")
        conversation = attrs.get("conversation", getattr(self.instance, "conversation", None))
        for user in attrs.get("mentions", []):
            if conversation and not conversation.participants.filter(pk=user.pk).exists():
                raise serializers.ValidationError({"mentions": "Mentioned users must belong to the conversation."})
        return attrs


class ConversationSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    participant_details = UserSerializer(source="participants", many=True, read_only=True)
    latest_message = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            "id",
            "patient",
            "patient_name",
            "title",
            "kind",
            "participants",
            "participant_details",
            "created_by",
            "active",
            "latest_message",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def get_latest_message(self, obj):
        message = obj.messages.last()
        return MessageSerializer(message, context=self.context).data if message else None


class ShiftAssignmentSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    caregiver_name = serializers.CharField(source="caregiver.display_name", read_only=True)

    class Meta:
        model = ShiftAssignment
        fields = [
            "id",
            "patient",
            "patient_name",
            "caregiver",
            "caregiver_name",
            "starts_at",
            "ends_at",
            "status",
            "notes",
            "accepted_at",
            "checked_in_at",
            "checked_out_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "accepted_at", "checked_in_at", "checked_out_at", "created_at", "updated_at"]

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "A shift must end after it starts."})
        return attrs


class CaregiverAvailabilitySerializer(serializers.ModelSerializer):
    caregiver_name = serializers.CharField(source="caregiver.display_name", read_only=True)

    class Meta:
        model = CaregiverAvailability
        fields = ["id", "caregiver", "caregiver_name", "starts_at", "ends_at", "available", "note", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "Availability must end after it starts."})
        return attrs
