from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import (
    LoginView,
    LogoutView,
    MeView,
    MfaViewSet,
    OrganizationViewSet,
    PasswordChangeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RotateSessionView,
    SessionViewSet,
    UserViewSet,
)
from apps.care_tasks.views import CareTaskTemplateViewSet, TaskOccurrenceViewSet, TaskViewSet
from apps.clinical.views import (
    AdvanceDirectiveViewSet,
    AllergyViewSet,
    CarePlanViewSet,
    ClinicalDocumentViewSet,
    DiagnosisViewSet,
    EmergencyContactViewSet,
    VitalThresholdViewSet,
    WoundRecordViewSet,
)
from apps.common.views import LivenessView, MetricsView, OpenApiSchemaView, ReadinessView
from apps.communications.views import (
    CaregiverAvailabilityViewSet,
    ConversationViewSet,
    MessageViewSet,
    ShiftAssignmentViewSet,
)
from apps.health.views import CustomVitalTypeViewSet, VitalRecordViewSet
from apps.interoperability.views import FhirMetadataView, FhirResourceView
from apps.medications.views import (
    DoseLogViewSet,
    MedicationInteractionViewSet,
    MedicationViewSet,
    RefillRequestViewSet,
    StockAdjustmentViewSet,
)
from apps.patients.views import CareAssignmentViewSet, PatientViewSet
from apps.reports.views import ShiftReportViewSet
from apps.safety.views import (
    AuditEventViewSet,
    CareNotificationViewSet,
    DeliveryReceiptView,
    EscalationPolicyViewSet,
    EscalationStepViewSet,
    NotificationDeliveryViewSet,
    NotificationPreferenceViewSet,
    PushSubscriptionViewSet,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("organizations", OrganizationViewSet, basename="organization")
router.register("sessions", SessionViewSet, basename="session")
router.register("mfa", MfaViewSet, basename="mfa")
router.register("patients", PatientViewSet, basename="patient")
router.register("assignments", CareAssignmentViewSet, basename="assignment")
router.register("tasks", TaskViewSet, basename="task")
router.register("task-templates", CareTaskTemplateViewSet, basename="task-template")
router.register("occurrences", TaskOccurrenceViewSet, basename="occurrence")
router.register("medications", MedicationViewSet, basename="medication")
router.register("dose-logs", DoseLogViewSet, basename="dose-log")
router.register("medication-interactions", MedicationInteractionViewSet, basename="medication-interaction")
router.register("refill-requests", RefillRequestViewSet, basename="refill-request")
router.register("stock-adjustments", StockAdjustmentViewSet, basename="stock-adjustment")
router.register("vitals", VitalRecordViewSet, basename="vital")
router.register("vital-types", CustomVitalTypeViewSet, basename="vital-type")
router.register("shift-reports", ShiftReportViewSet, basename="shift-report")
router.register("audit-events", AuditEventViewSet, basename="audit-event")
router.register("notifications", CareNotificationViewSet, basename="notification")
router.register("allergies", AllergyViewSet, basename="allergy")
router.register("diagnoses", DiagnosisViewSet, basename="diagnosis")
router.register("care-plans", CarePlanViewSet, basename="care-plan")
router.register("emergency-contacts", EmergencyContactViewSet, basename="emergency-contact")
router.register("advance-directives", AdvanceDirectiveViewSet, basename="advance-directive")
router.register("clinical-documents", ClinicalDocumentViewSet, basename="clinical-document")
router.register("wound-records", WoundRecordViewSet, basename="wound-record")
router.register("vital-thresholds", VitalThresholdViewSet, basename="vital-threshold")
router.register("conversations", ConversationViewSet, basename="conversation")
router.register("messages", MessageViewSet, basename="message")
router.register("shift-assignments", ShiftAssignmentViewSet, basename="shift-assignment")
router.register("caregiver-availability", CaregiverAvailabilityViewSet, basename="caregiver-availability")
router.register("notification-preferences", NotificationPreferenceViewSet, basename="notification-preference")
router.register("push-subscriptions", PushSubscriptionViewSet, basename="push-subscription")
router.register("escalation-policies", EscalationPolicyViewSet, basename="escalation-policy")
router.register("escalation-steps", EscalationStepViewSet, basename="escalation-step")
router.register("notification-deliveries", NotificationDeliveryViewSet, basename="notification-delivery")

urlpatterns = [
    path("health/live/", LivenessView.as_view(), name="health-live"),
    path("health/ready/", ReadinessView.as_view(), name="health-ready"),
    path("metrics/", MetricsView.as_view(), name="metrics"),
    path("api/v1/schema/", OpenApiSchemaView.as_view(), name="openapi-schema"),
    path("admin/", admin.site.urls),
    path("api/v1/auth/login/", LoginView.as_view(), name="login"),
    path("api/v1/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/v1/auth/me/", MeView.as_view(), name="me"),
    path("api/v1/auth/rotate/", RotateSessionView.as_view(), name="rotate-session"),
    path("api/v1/auth/password-reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path("api/v1/auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("api/v1/auth/change-password/", PasswordChangeView.as_view(), name="change-password"),
    path("api/v1/delivery-receipts/<str:channel>/", DeliveryReceiptView.as_view(), name="delivery-receipt"),
    path("api/v1/fhir/metadata/", FhirMetadataView.as_view(), name="fhir-metadata"),
    path("api/v1/fhir/<str:resource_type>/", FhirResourceView.as_view(), name="fhir-resource-list"),
    path("api/v1/fhir/<str:resource_type>/<str:resource_id>/", FhirResourceView.as_view(), name="fhir-resource-detail"),
    path("api/v1/", include(router.urls)),
]
