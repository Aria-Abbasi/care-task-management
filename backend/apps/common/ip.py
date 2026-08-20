import ipaddress
import logging
from django.conf import settings

logger = logging.getLogger(__name__)


def _parse_ip_or_network(value):
    try:
        if "/" in value:
            return ipaddress.ip_network(value, strict=False)
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def is_ip_in_trusted_proxies(ip_str):
    if not ip_str:
        return False
    try:
        target_ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False

    trusted_list = getattr(settings, "HAVEN_TRUSTED_PROXIES", ["127.0.0.1", "::1"])
    for entry in trusted_list:
        parsed = _parse_ip_or_network(entry)
        if parsed is None:
            continue
        if isinstance(parsed, (ipaddress.IPv4Network, ipaddress.IPv6Network)):
            if target_ip in parsed:
                return True
        elif target_ip == parsed:
            return True
    return False


def get_client_ip(request):
    """
    Extracts the client IP safely from the request.
    Only honors X-Forwarded-For if REMOTE_ADDR is in HAVEN_TRUSTED_PROXIES.
    Traverses X-Forwarded-For from right to left, stripping trusted proxies.
    """
    remote_addr = request.META.get("REMOTE_ADDR", "").strip()
    if not remote_addr:
        return ""

    if not is_ip_in_trusted_proxies(remote_addr):
        return remote_addr

    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if not x_forwarded_for:
        return remote_addr

    ip_chain = [ip.strip() for ip in x_forwarded_for.split(",") if ip.strip()]
    if not ip_chain:
        return remote_addr

    # Traverse from right to left (closest proxy to furthest client)
    for ip in reversed(ip_chain):
        try:
            parsed_ip = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if not is_ip_in_trusted_proxies(str(parsed_ip)):
            return str(parsed_ip)

    # If all IPs in chain are trusted proxies, return leftmost valid IP
    return ip_chain[0]
