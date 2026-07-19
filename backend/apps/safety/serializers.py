from rest_framework import serializers

from .models import (
    AuditEvent,
    CareNotification,
    EscalationPolicy,
    EscalationStep,
    NotificationDelivery,
    NotificationPreference,
    PushSubscription,
)


class AuditEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source="actor.display_name", read_only=True)
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)

    class Meta:
        model = AuditEvent
        fields = [
            "id",
            "actor",
            "actor_name",
            "patient",
            "patient_name",
            "action",
            "entity_type",
            "entity_id",
            "summary",
            "metadata",
            "client_reference",
            "created_at",
        ]


class CareNotificationSerializer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source="patient.full_name", read_only=True)
    delivery_status = serializers.SerializerMethodField()

    class Meta:
        model = CareNotification
        fields = [
            "id",
            "patient",
            "patient_name",
            "kind",
            "severity",
            "state",
            "title",
            "message",
            "source_type",
            "source_id",
            "escalation_level",
            "due_at",
            "read_at",
            "acknowledged_at",
            "snoozed_until",
            "delivery_status",
            "created_at",
            "updated_at",
        ]

    def get_delivery_status(self, obj):
        return {delivery.channel: delivery.status for delivery in obj.deliveries.all()}


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = [
            "push_enabled",
            "sms_enabled",
            "voice_enabled",
            "quiet_hours_start",
            "quiet_hours_end",
            "critical_override",
            "timezone",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]


class PushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushSubscription
        fields = [
            "id",
            "endpoint",
            "p256dh",
            "auth",
            "device_name",
            "active",
            "failure_count",
            "last_delivered_at",
            "created_at",
        ]
        read_only_fields = ["id", "failure_count", "last_delivered_at", "created_at"]


class EscalationStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = EscalationStep
        fields = ["id", "policy", "level", "delay_minutes", "channel", "recipient_roles", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class EscalationPolicySerializer(serializers.ModelSerializer):
    steps = EscalationStepSerializer(many=True, read_only=True)

    class Meta:
        model = EscalationPolicy
        fields = ["id", "organization", "name", "active", "is_default", "steps", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class NotificationDeliverySerializer(serializers.ModelSerializer):
    notification_title = serializers.CharField(source="notification.title", read_only=True)

    class Meta:
        model = NotificationDelivery
        fields = [
            "id",
            "notification",
            "notification_title",
            "channel",
            "status",
            "destination_hint",
            "provider_id",
            "attempts",
            "error",
            "next_attempt_at",
            "accepted_at",
            "delivered_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields
