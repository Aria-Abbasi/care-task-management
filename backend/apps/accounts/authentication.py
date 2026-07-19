from datetime import timedelta

from django.utils import timezone
from rest_framework import authentication, exceptions

from .models import SessionToken


class ExpiringSessionAuthentication(authentication.BaseAuthentication):
    keyword = "Token"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).split()
        if not header:
            return None
        if header[0].lower() not in {b"token", b"bearer"}:
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed("Invalid authorization header.")
        try:
            raw = header[1].decode()
        except UnicodeError as exc:
            raise exceptions.AuthenticationFailed("Invalid session token.") from exc
        session = (
            SessionToken.objects.select_related("user", "user__organization")
            .filter(key_prefix=raw[:12], key_hash=SessionToken.digest(raw))
            .first()
        )
        if not session or not session.active or not session.user.is_active:
            raise exceptions.AuthenticationFailed("Session expired or revoked.")
        if session.last_used_at is None or session.last_used_at < timezone.now() - timedelta(minutes=5):
            session.last_used_at = timezone.now()
            session.save(update_fields=["last_used_at", "updated_at"])
        return session.user, session
