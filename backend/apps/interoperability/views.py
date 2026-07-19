from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.clinical.models import CarePlan
from apps.health.models import VitalRecord
from apps.medications.models import DoseLog, Medication
from apps.patients.access import patients_for_user
from apps.patients.models import Patient
from apps.safety.models import AuditEvent

from .fhir import (
    audit_event_resource,
    bundle,
    care_plan_resource,
    medication_administration_resource,
    medication_request_resource,
    observation_resource,
    patient_resource,
)


class FhirMetadataView(APIView):
    def get(self, request):
        return Response(
            {
                "resourceType": "CapabilityStatement",
                "status": "active",
                "date": "2026-07-16",
                "kind": "instance",
                "fhirVersion": "5.0.0",
                "format": ["application/fhir+json", "json"],
                "rest": [
                    {
                        "mode": "server",
                        "resource": [
                            {"type": resource, "interaction": [{"code": "read"}, {"code": "search-type"}]}
                            for resource in [
                                "Patient",
                                "Observation",
                                "MedicationRequest",
                                "MedicationAdministration",
                                "CarePlan",
                                "AuditEvent",
                            ]
                        ],
                    }
                ],
            },
            content_type="application/fhir+json",
        )


class FhirResourceView(APIView):
    def get(self, request, resource_type, resource_id=None):
        patient_ids = patients_for_user(request.user).values_list("id", flat=True)
        patient_filter = request.query_params.get("patient")
        try:
            requested_patient_id = int(patient_filter) if patient_filter else None
        except (TypeError, ValueError):
            return Response(
                {"resourceType": "OperationOutcome", "issue": [{"severity": "error", "code": "invalid"}]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if requested_patient_id and requested_patient_id not in patient_ids:
            return Response(
                {"resourceType": "OperationOutcome", "issue": [{"severity": "error", "code": "forbidden"}]},
                status=status.HTTP_403_FORBIDDEN,
            )
        mappings = {
            "Patient": (Patient.objects.filter(id__in=patient_ids), patient_resource),
            "Observation": (
                VitalRecord.objects.filter(patient_id__in=patient_ids).select_related("patient", "recorded_by"),
                observation_resource,
            ),
            "MedicationRequest": (
                Medication.objects.filter(patient_id__in=patient_ids).select_related("patient"),
                medication_request_resource,
            ),
            "MedicationAdministration": (
                DoseLog.objects.filter(medication__patient_id__in=patient_ids).select_related(
                    "medication", "medication__patient", "administered_by"
                ),
                medication_administration_resource,
            ),
            "CarePlan": (CarePlan.objects.filter(patient_id__in=patient_ids).select_related("patient", "author"), care_plan_resource),
            "AuditEvent": (AuditEvent.objects.filter(patient_id__in=patient_ids).select_related("patient", "actor"), audit_event_resource),
        }
        if resource_type not in mappings:
            return Response(
                {"resourceType": "OperationOutcome", "issue": [{"severity": "error", "code": "not-supported"}]},
                status=status.HTTP_404_NOT_FOUND,
            )
        queryset, mapper = mappings[resource_type]
        if patient_filter and resource_type != "Patient":
            patient_path = (
                "patient_id"
                if resource_type in {"Observation", "MedicationRequest", "CarePlan", "AuditEvent"}
                else "medication__patient_id"
            )
            queryset = queryset.filter(**{patient_path: patient_filter})
        if resource_id:
            instance = queryset.filter(pk=resource_id).first()
            if not instance:
                return Response(
                    {"resourceType": "OperationOutcome", "issue": [{"severity": "error", "code": "not-found"}]},
                    status=status.HTTP_404_NOT_FOUND,
                )
            return Response(mapper(instance), content_type="application/fhir+json")
        return Response(bundle([mapper(item) for item in queryset[:100]]), content_type="application/fhir+json")
