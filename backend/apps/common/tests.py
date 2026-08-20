import os
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status


class MetricsViewSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_metrics_endpoint_returns_403_when_token_is_missing_or_empty(self):
        # 1. Unset environment variable
        with patch.dict(os.environ, {}, clear=True):
            response = self.client.get("/metrics/")
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Empty environment variable
        with patch.dict(os.environ, {"HAVEN_METRICS_TOKEN": ""}):
            response = self.client.get("/metrics/")
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Invalid token provided
        with patch.dict(os.environ, {"HAVEN_METRICS_TOKEN": "secret-metrics-token-123"}):
            response = self.client.get("/metrics/", HTTP_AUTHORIZATION="Bearer wrong-token")
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

            # 4. Valid token provided
            response = self.client.get("/metrics/", HTTP_AUTHORIZATION="Bearer secret-metrics-token-123")
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertIn("haven_notifications_active", response.content.decode())
