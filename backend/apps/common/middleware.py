import uuid


class RequestSecurityMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))[:100]
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        response["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
            "img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self' https: wss:; media-src 'self' blob:; worker-src 'self' blob:"
        )
        response["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()"
        response["Cross-Origin-Opener-Policy"] = "same-origin"
        response["Cross-Origin-Resource-Policy"] = "same-site"
        response["X-Content-Type-Options"] = "nosniff"
        return response
