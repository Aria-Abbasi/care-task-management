import os
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.getenv("HAVEN_DEBUG", "true").lower() == "true"
SECRET_KEY = os.getenv("HAVEN_SECRET_KEY", "dev-only-secret-key-change-in-production" if DEBUG else "")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set when DEBUG is false.")
ALLOWED_HOSTS = [value.strip() for value in os.getenv("HAVEN_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",") if value.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "django_filters",
    "rest_framework",
    "rest_framework.authtoken",
    "apps.accounts",
    "apps.patients",
    "apps.care_tasks",
    "apps.medications",
    "apps.health",
    "apps.reports",
    "apps.safety",
    "apps.clinical",
    "apps.communications",
    "apps.interoperability",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.common.middleware.RequestSecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

DATABASES = {
    "default": dj_database_url.config(
        env="HAVEN_DATABASE_URL",
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=60,
        conn_health_checks=True,
    )
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache"
        if os.getenv("HAVEN_REDIS_URL")
        else "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": os.getenv("HAVEN_REDIS_URL", "haven-local-cache"),
    }
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("HAVEN_TIME_ZONE", "Asia/Tehran")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = [
    value.strip() for value in os.getenv("HAVEN_CORS_ALLOWED_ORIGINS", "http://localhost:5173").split(",") if value.strip()
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.ExpiringSessionAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"]
    if not DEBUG
    else [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
}

CELERY_BROKER_URL = os.getenv("HAVEN_REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_TRACK_STARTED = True
CELERY_BEAT_SCHEDULE = {
    "maintain-task-occurrences": {
        "task": "apps.care_tasks.tasks.maintain_task_occurrences",
        "schedule": 300.0,
    },
    "scan-overdue-care": {
        "task": "apps.safety.tasks.scan_overdue_care",
        "schedule": 120.0,
    },
    "dispatch-notifications": {
        "task": "apps.safety.tasks.dispatch_pending_notifications",
        "schedule": 60.0,
    },
    "purge-expired-documents-daily": {
        "task": "apps.clinical.tasks.purge_expired_clinical_documents",
        "schedule": 86400.0,
    },
    "purge-expired-security-records-daily": {
        "task": "apps.accounts.tasks.purge_expired_security_records",
        "schedule": 86400.0,
    },
}

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Strict"
CSRF_COOKIE_SAMESITE = "Strict"
SECURE_HSTS_SECONDS = 0 if DEBUG else int(os.getenv("HAVEN_HSTS_SECONDS", "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
SECURE_SSL_REDIRECT = os.getenv("HAVEN_SECURE_SSL_REDIRECT", "false" if DEBUG else "true").lower() == "true"

HAVEN_FRONTEND_URL = os.getenv("HAVEN_FRONTEND_URL", "http://localhost:5173")
HAVEN_PUBLIC_API_URL = os.getenv("HAVEN_PUBLIC_API_URL", "http://localhost:8000")
HAVEN_VAPID_PUBLIC_KEY = os.getenv("HAVEN_VAPID_PUBLIC_KEY", "")
HAVEN_DELIVERY_WEBHOOK_SECRET = os.getenv("HAVEN_DELIVERY_WEBHOOK_SECRET", "local-delivery-secret" if DEBUG else "")
if not DEBUG and len(HAVEN_DELIVERY_WEBHOOK_SECRET) < 24:
    raise RuntimeError("HAVEN_DELIVERY_WEBHOOK_SECRET must be at least 24 characters in production")
HAVEN_TRUSTED_PROXIES = [ip.strip() for ip in os.getenv("HAVEN_TRUSTED_PROXIES", "127.0.0.1,::1").split(",") if ip.strip()]
HAVEN_LOGIN_MAX_FAILURES = int(os.getenv("HAVEN_LOGIN_MAX_FAILURES", "5"))
HAVEN_LOGIN_WINDOW_MINUTES = int(os.getenv("HAVEN_LOGIN_WINDOW_MINUTES", "15"))
DEFAULT_FROM_EMAIL = os.getenv("HAVEN_FROM_EMAIL", "security@haven.local")
EMAIL_BACKEND = os.getenv("HAVEN_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "apps.common.logging.JsonFormatter"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": os.getenv("HAVEN_LOG_LEVEL", "INFO")},
}

SENTRY_DSN = os.getenv("HAVEN_SENTRY_DSN", "")
if SENTRY_DSN:
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=SENTRY_DSN, send_default_pii=False, traces_sample_rate=0.1)
    except ImportError:
        pass
