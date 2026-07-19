import base64
import json
import os
from urllib import parse, request

from django.conf import settings

from .models import EscalationStep, PushSubscription


class DeliveryConfigurationError(RuntimeError):
    pass


def _twilio_request(path, values):
    sid = os.getenv("HAVEN_TWILIO_ACCOUNT_SID", "")
    token = os.getenv("HAVEN_TWILIO_AUTH_TOKEN", "")
    if not sid or not token:
        raise DeliveryConfigurationError("SMS/voice provider credentials are not configured.")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/{path}"
    payload = parse.urlencode(values).encode()
    http = request.Request(url, data=payload, method="POST")
    credentials = base64.b64encode(f"{sid}:{token}".encode()).decode()
    http.add_header("Authorization", f"Basic {credentials}")
    http.add_header("Content-Type", "application/x-www-form-urlencoded")
    with request.urlopen(http, timeout=10) as response:  # noqa: S310 - fixed provider endpoint
        return json.loads(response.read().decode())


def send_sms(delivery):
    recipient = delivery.notification.recipient
    sender = os.getenv("HAVEN_TWILIO_FROM_NUMBER", "")
    if not recipient.phone or not sender:
        raise DeliveryConfigurationError("Recipient or sender phone number is missing.")
    callback = f"{settings.HAVEN_PUBLIC_API_URL.rstrip('/')}/api/v1/delivery-receipts/sms/?receipt={delivery.receipt_token}"
    result = _twilio_request(
        "Messages.json",
        {
            "To": recipient.phone,
            "From": sender,
            "Body": "Haven: a critical care item needs attention. Open Haven to review it securely.",
            "StatusCallback": callback,
        },
    )
    return result.get("sid", "")


def send_voice(delivery):
    recipient = delivery.notification.recipient
    sender = os.getenv("HAVEN_TWILIO_FROM_NUMBER", "")
    if not recipient.phone or not sender:
        raise DeliveryConfigurationError("Recipient or sender phone number is missing.")
    callback = f"{settings.HAVEN_PUBLIC_API_URL.rstrip('/')}/api/v1/delivery-receipts/voice/?receipt={delivery.receipt_token}"
    twiml = "<Response><Say>A critical Haven care alert needs attention. Please open Haven now.</Say></Response>"
    result = _twilio_request(
        "Calls.json",
        {
            "To": recipient.phone,
            "From": sender,
            "Twiml": twiml,
            "StatusCallback": callback,
            "StatusCallbackEvent": "completed",
        },
    )
    return result.get("sid", "")


def send_web_push(delivery):
    try:
        from pywebpush import WebPushException, webpush
    except ImportError as exc:
        raise DeliveryConfigurationError("pywebpush is not installed.") from exc
    private_key = os.getenv("HAVEN_VAPID_PRIVATE_KEY", "")
    subject = os.getenv("HAVEN_VAPID_SUBJECT", "mailto:security@haven.local")
    if not private_key:
        raise DeliveryConfigurationError("VAPID credentials are not configured.")
    subscriptions = PushSubscription.objects.filter(user=delivery.notification.recipient, active=True)
    if not subscriptions.exists():
        raise DeliveryConfigurationError("No active browser push subscription is registered.")
    payload = json.dumps(
        {
            "title": "Critical care alert" if delivery.notification.severity == "CRITICAL" else "Care reminder",
            "body": "Open Haven to review this care alert securely.",
            "url": "/?alerts=open",
            "receipt": str(delivery.receipt_token),
        }
    )
    accepted = 0
    errors = []
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=payload,
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},
                ttl=300,
            )
            accepted += 1
        except WebPushException as exc:
            subscription.failure_count += 1
            if getattr(exc.response, "status_code", None) in {404, 410}:
                subscription.active = False
            subscription.save(update_fields=["failure_count", "active", "updated_at"])
            errors.append(str(exc))
    if not accepted:
        raise RuntimeError("; ".join(errors) or "No push service accepted the notification.")
    return f"web-push:{accepted}"


def deliver(delivery):
    if delivery.channel == EscalationStep.Channel.PUSH:
        return send_web_push(delivery)
    if delivery.channel == EscalationStep.Channel.SMS:
        return send_sms(delivery)
    if delivery.channel == EscalationStep.Channel.VOICE:
        return send_voice(delivery)
    return "in-app"
