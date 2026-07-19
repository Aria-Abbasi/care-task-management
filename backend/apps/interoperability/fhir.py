from django.utils import timezone

FHIR_SYSTEM = "https://haven.care/fhir"


def reference(resource_type, resource_id, display=None):
    value = {"reference": f"{resource_type}/{resource_id}"}
    if display:
        value["display"] = display
    return value


def patient_resource(patient):
    return {
        "resourceType": "Patient",
        "id": str(patient.id),
        "meta": {"lastUpdated": patient.updated_at.isoformat()},
        "active": patient.active,
        "name": [{"use": "official", "family": patient.last_name, "given": [patient.first_name], "text": patient.full_name}],
        "gender": patient.gender.lower() if patient.gender in {"MALE", "FEMALE", "OTHER"} else "unknown",
        "birthDate": patient.birth_date.isoformat(),
        "extension": [{"url": f"{FHIR_SYSTEM}/StructureDefinition/room", "valueString": patient.room}] if patient.room else [],
    }


def observation_resource(record):
    components = []
    if record.type == "BLOOD_PRESSURE":
        components = [
            {"code": {"text": "Systolic blood pressure"}, "valueQuantity": {"value": float(record.value), "unit": record.unit}},
            {"code": {"text": "Diastolic blood pressure"}, "valueQuantity": {"value": float(record.secondary_value), "unit": record.unit}},
        ]
    resource = {
        "resourceType": "Observation",
        "id": str(record.id),
        "meta": {"lastUpdated": record.updated_at.isoformat(), "source": record.source_system},
        "status": "final",
        "code": {"text": record.get_type_display()},
        "subject": reference("Patient", record.patient_id, record.patient.full_name),
        "effectiveDateTime": record.recorded_at.isoformat(),
        "performer": [reference("Practitioner", record.recorded_by_id, record.recorded_by.display_name)] if record.recorded_by else [],
        "note": [{"text": record.note}] if record.note else [],
    }
    if components:
        resource["component"] = components
    else:
        resource["valueQuantity"] = {"value": float(record.value), "unit": record.unit}
    return resource


def medication_request_resource(medication):
    status = "active" if medication.active and medication.approval_status == "APPROVED" else "draft"
    return {
        "resourceType": "MedicationRequest",
        "id": str(medication.id),
        "meta": {"lastUpdated": medication.updated_at.isoformat()},
        "status": status,
        "intent": "order",
        "medication": {
            "concept": {
                "coding": [{"system": medication.code_system, "code": medication.medication_code, "display": medication.name}],
                "text": medication.name,
            }
        },
        "subject": reference("Patient", medication.patient_id, medication.patient.full_name),
        "authoredOn": medication.created_at.isoformat(),
        "dosageInstruction": [
            {
                "text": medication.instructions,
                "route": {"text": medication.route},
                "doseAndRate": [{"doseQuantity": {"value": float(medication.dose), "unit": medication.unit}}],
                "asNeeded": medication.is_prn,
            }
        ],
    }


def medication_administration_resource(dose):
    status_map = {"GIVEN": "completed", "MISSED": "not-done", "REFUSED": "not-done", "HELD": "on-hold", "SCHEDULED": "in-progress"}
    return {
        "resourceType": "MedicationAdministration",
        "id": str(dose.id),
        "meta": {"lastUpdated": dose.updated_at.isoformat()},
        "status": status_map[dose.status],
        "medication": {"reference": reference("MedicationRequest", dose.medication_id, dose.medication.name)},
        "subject": reference("Patient", dose.medication.patient_id, dose.medication.patient.full_name),
        "occurenceDateTime": (dose.administered_at or dose.scheduled_at).isoformat(),
        "performer": [{"actor": reference("Practitioner", dose.administered_by_id, dose.administered_by.display_name)}]
        if dose.administered_by
        else [],
        "note": [{"text": dose.note}] if dose.note else [],
    }


def care_plan_resource(plan):
    status_map = {"DRAFT": "draft", "ACTIVE": "active", "ON_HOLD": "on-hold", "COMPLETED": "completed"}
    return {
        "resourceType": "CarePlan",
        "id": str(plan.id),
        "meta": {"lastUpdated": plan.updated_at.isoformat(), "source": plan.source_system},
        "status": status_map[plan.status],
        "intent": "plan",
        "title": plan.title,
        "description": plan.instructions,
        "subject": reference("Patient", plan.patient_id, plan.patient.full_name),
        "period": {
            "start": plan.starts_on.isoformat() if plan.starts_on else None,
            "end": plan.ends_on.isoformat() if plan.ends_on else None,
        },
        "goal": [{"display": str(goal)} for goal in plan.goals],
        "author": reference("Practitioner", plan.author_id, plan.author.display_name),
    }


def audit_event_resource(event):
    return {
        "resourceType": "AuditEvent",
        "id": str(event.id),
        "meta": {"lastUpdated": event.created_at.isoformat()},
        "type": {"system": FHIR_SYSTEM, "code": event.action, "display": event.summary},
        "action": "E",
        "recorded": event.created_at.isoformat(),
        "outcome": {"code": {"system": FHIR_SYSTEM, "code": "success"}},
        "agent": [{"who": reference("Practitioner", event.actor_id, event.actor.display_name), "requestor": True}] if event.actor else [],
        "source": {"observer": {"display": "Haven Care"}},
        "entity": [{"what": reference(event.entity_type, event.entity_id), "name": event.summary}],
    }


def bundle(resources):
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "timestamp": timezone.now().isoformat(),
        "total": len(resources),
        "entry": [{"fullUrl": f"{FHIR_SYSTEM}/{item['resourceType']}/{item['id']}", "resource": item} for item in resources],
    }
