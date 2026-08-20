import os
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.db import connection
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView


class LivenessView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({"status": "alive", "time": timezone.now()})


class ReadinessView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from apps.safety.models import WorkerHeartbeat

        checks = {}
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                checks["database"] = cursor.fetchone()[0] == 1
        except Exception:
            checks["database"] = False
        try:
            cache.set("haven-readiness", "ok", 10)
            checks["cache"] = cache.get("haven-readiness") == "ok"
        except Exception:
            checks["cache"] = False
        cutoff = timezone.now() - timedelta(minutes=3)
        checks["overdue_scanner"] = WorkerHeartbeat.objects.filter(name="overdue-scanner", last_seen_at__gte=cutoff).exists()
        checks["notification_dispatcher"] = WorkerHeartbeat.objects.filter(
            name="notification-dispatcher", last_seen_at__gte=cutoff
        ).exists()
        ready = all(checks.values())
        return Response(
            {"status": "ready" if ready else "degraded", "checks": checks},
            status=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


class MetricsView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        import secrets

        from apps.safety.models import CareNotification, NotificationDelivery, WorkerHeartbeat

        expected = os.getenv("HAVEN_METRICS_TOKEN", "")
        auth_header = request.headers.get("Authorization", "")
        expected_header = f"Bearer {expected}" if expected else ""
        if not expected or not secrets.compare_digest(auth_header, expected_header):
            return Response(status=status.HTTP_403_FORBIDDEN)
        lines = [
            "# HELP haven_notifications_active Active unacknowledged care notifications",
            "# TYPE haven_notifications_active gauge",
            f"haven_notifications_active {CareNotification.objects.exclude(state='ACKNOWLEDGED').count()}",
            "# HELP haven_notification_deliveries Delivery records by state",
            "# TYPE haven_notification_deliveries gauge",
        ]
        for state, _ in NotificationDelivery.Status.choices:
            lines.append(
                f'haven_notification_deliveries{{status="{state.lower()}"}} {NotificationDelivery.objects.filter(status=state).count()}'
            )
        now = timezone.now()
        for heartbeat in WorkerHeartbeat.objects.all():
            age = max(0, (now - heartbeat.last_seen_at).total_seconds())
            lines.append(f'haven_worker_heartbeat_age_seconds{{worker="{heartbeat.name}"}} {age:.0f}')
        return HttpResponse("\n".join(lines) + "\n", content_type="text/plain; version=0.0.4")


class OpenApiSchemaView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        candidate_paths = [
            Path(settings.BASE_DIR).parent / "docs" / "openapi.yaml",
            Path(settings.BASE_DIR) / "docs" / "openapi.yaml",
            Path(__file__).resolve().parents[3] / "docs" / "openapi.yaml",
            Path(__file__).resolve().parents[2] / "docs" / "openapi.yaml",
            Path("/docs/openapi.yaml"),
            Path("/app/docs/openapi.yaml"),
        ]
        for path in candidate_paths:
            if path.is_file():
                return HttpResponse(path.read_text(), content_type="application/yaml")
        return HttpResponse("openapi: 3.0.3\ninfo:\n  title: Haven API\n  version: 1.0.0\npaths: {}\n", content_type="application/yaml")
