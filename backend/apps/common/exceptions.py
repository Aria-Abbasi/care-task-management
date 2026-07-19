from rest_framework.exceptions import APIException


class VersionConflict(APIException):
    status_code = 409
    default_code = "version_conflict"

    def __init__(self, current, message="This care record changed on another device."):
        super().__init__({"detail": message, "code": self.default_code, "current": current})
