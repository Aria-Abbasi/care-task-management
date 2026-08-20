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


class ClientIpExtractionTests(TestCase):
    def test_untrusted_direct_client_ignores_x_forwarded_for(self):
        from apps.common.ip import get_client_ip
        from django.test import RequestFactory

        rf = RequestFactory()
        # Direct untrusted client connecting from 198.51.100.5 attempting to spoof 203.0.113.1
        request = rf.get("/api/v1/auth/login/", REMOTE_ADDR="198.51.100.5", HTTP_X_FORWARDED_FOR="203.0.113.1")
        with self.settings(HAVEN_TRUSTED_PROXIES=["127.0.0.1", "10.0.0.0/8"]):
            ip = get_client_ip(request)
            self.assertEqual(ip, "198.51.100.5")

    def test_trusted_proxy_resolves_client_ip_from_chain(self):
        from apps.common.ip import get_client_ip
        from django.test import RequestFactory

        rf = RequestFactory()
        # Connection from trusted internal proxy 10.0.1.20 with forwarded client chain
        request = rf.get(
            "/api/v1/auth/login/",
            REMOTE_ADDR="10.0.1.20",
            HTTP_X_FORWARDED_FOR="203.0.113.50, 10.0.2.1",
        )
        with self.settings(HAVEN_TRUSTED_PROXIES=["127.0.0.1", "10.0.0.0/8"]):
            ip = get_client_ip(request)
            self.assertEqual(ip, "203.0.113.50")

    def test_trusted_proxy_single_client_ip(self):
        from apps.common.ip import get_client_ip
        from django.test import RequestFactory

        rf = RequestFactory()
        request = rf.get(
            "/api/v1/auth/login/",
            REMOTE_ADDR="127.0.0.1",
            HTTP_X_FORWARDED_FOR="198.51.100.77",
        )
        with self.settings(HAVEN_TRUSTED_PROXIES=["127.0.0.1"]):
            ip = get_client_ip(request)
            self.assertEqual(ip, "198.51.100.77")
