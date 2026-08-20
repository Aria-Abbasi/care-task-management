from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts.context import get_active_organization_id, get_tenant_role
from apps.accounts.models import Organization, User
from apps.clinical.services import evaluate_vital_threshold
from apps.patients.access import patients_for_user
from apps.safety.services import record_audit

from .models import CustomVitalType, VitalRecord
from .serializers import CustomVitalTypeSerializer, VitalRecordSerializer


class CustomVitalTypeViewSet(viewsets.ModelViewSet):
    serializer_class = CustomVitalTypeSerializer
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["active"]
    search_fields = ["name", "slug", "description"]
    ordering_fields = ["name", "created_at"]

    def get_queryset(self):
        queryset = CustomVitalType.objects.filter(active=True).select_related("organization", "created_by")
        if self.request.user.is_superuser:
            return queryset
        active_org_id = get_active_organization_id(self.request.user, self.request)
        if active_org_id:
            return queryset.filter(organization_id=active_org_id)
        return queryset.filter(organization_id=self.request.user.organization_id)

    def create(self, request, *args, **kwargs):
        tenant_role = get_tenant_role(request.user, request)
        if not (request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot create custom vital types.")
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot create custom vital types.")
        active_org_id = get_active_organization_id(self.request.user, self.request)
        if active_org_id:
            organization = Organization.objects.get(pk=active_org_id)
        else:
            organization = self.request.user.organization
        vital_type = serializer.save(
            organization=organization,
            created_by=self.request.user,
        )
        record_audit(
            actor=self.request.user,
            patient=None,
            action="CUSTOM_VITAL_TYPE_CREATED",
            instance=vital_type,
            summary=f"Created custom vital type: {vital_type.name} ({vital_type.unit})",
            metadata={"slug": vital_type.slug, "unit": vital_type.unit},
        )

    @action(detail=False, methods=["get"], url_path="options")
    def options(self, request):
        built_in = [
            {"type": "BLOOD_PRESSURE", "name": "Blood pressure", "unit": "mmHg", "is_custom": False, "requires_secondary": True},
            {"type": "HEART_RATE", "name": "Heart rate", "unit": "bpm", "is_custom": False, "requires_secondary": False},
            {"type": "OXYGEN", "name": "Oxygen saturation", "unit": "%", "is_custom": False, "requires_secondary": False},
            {"type": "TEMPERATURE", "name": "Temperature", "unit": "°C", "is_custom": False, "requires_secondary": False},
            {"type": "WEIGHT", "name": "Weight", "unit": "kg", "is_custom": False, "requires_secondary": False},
            {"type": "GLUCOSE", "name": "Blood glucose", "unit": "mg/dL", "is_custom": False, "requires_secondary": False},
        ]
        custom = [
            {
                "type": item.slug,
                "name": item.name,
                "unit": item.unit,
                "description": item.description,
                "is_custom": True,
                "requires_secondary": False,
                "id": item.id,
            }
            for item in self.get_queryset()
        ]
        return Response({"built_in": built_in, "custom": custom, "all": built_in + custom})


class VitalRecordViewSet(viewsets.ModelViewSet):
    serializer_class = VitalRecordSerializer
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["patient", "type"]
    ordering_fields = ["recorded_at", "created_at"]

    def get_queryset(self):
        patient_ids = patients_for_user(self.request.user, self.request).values_list("id", flat=True)
        queryset = VitalRecord.objects.filter(patient_id__in=patient_ids).select_related("patient", "recorded_by")
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")
        if start:
            queryset = queryset.filter(recorded_at__gte=start)
        if end:
            queryset = queryset.filter(recorded_at__lt=end)
        return queryset

    def create(self, request, *args, **kwargs):
        client_reference = request.data.get("client_reference")
        if client_reference:
            existing = self.get_queryset().filter(client_reference=client_reference).first()
            if existing:
                return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        tenant_role = get_tenant_role(self.request.user, self.request)
        if not (self.request.user.is_superuser or tenant_role in {User.Role.ADMIN, User.Role.DOCTOR, User.Role.CAREGIVER}):
            raise PermissionDenied("Family accounts cannot record clinical observations.")
        patient = serializer.validated_data["patient"]
        if not patients_for_user(self.request.user, self.request).filter(pk=patient.pk).exists():
            raise PermissionDenied("You are not assigned to this patient.")
        reading = serializer.save(recorded_by=self.request.user)
        record_audit(
            actor=self.request.user,
            patient=patient,
            action="VITAL_RECORDED",
            instance=reading,
            summary=f"Recorded {reading.get_type_display()}",
            metadata={"source_system": "Haven", "recorded_at": reading.recorded_at.isoformat()},
            client_reference=reading.client_reference,
        )
        evaluate_vital_threshold(reading)
