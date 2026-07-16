from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import LoginView, LogoutView, MeView, UserViewSet
from apps.care_tasks.views import TaskOccurrenceViewSet, TaskViewSet
from apps.health.views import VitalRecordViewSet
from apps.medications.views import DoseLogViewSet, MedicationViewSet
from apps.patients.views import CareAssignmentViewSet, PatientViewSet
from apps.reports.views import ShiftReportViewSet

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("patients", PatientViewSet, basename="patient")
router.register("assignments", CareAssignmentViewSet, basename="assignment")
router.register("tasks", TaskViewSet, basename="task")
router.register("occurrences", TaskOccurrenceViewSet, basename="occurrence")
router.register("medications", MedicationViewSet, basename="medication")
router.register("dose-logs", DoseLogViewSet, basename="dose-log")
router.register("vitals", VitalRecordViewSet, basename="vital")
router.register("shift-reports", ShiftReportViewSet, basename="shift-report")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/auth/login/", LoginView.as_view(), name="login"),
    path("api/v1/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/v1/auth/me/", MeView.as_view(), name="me"),
    path("api/v1/", include(router.urls)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
