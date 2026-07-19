from celery import shared_task
from django.utils import timezone

from apps.safety.services import record_audit

from .models import ClinicalDocument


@shared_task
def purge_expired_clinical_documents():
    documents = ClinicalDocument.objects.filter(retention_until__lt=timezone.localdate()).select_related("patient")
    purged = 0
    for document in documents:
        record_audit(
            actor=None,
            patient=document.patient,
            action="CLINICAL_DOCUMENT_RETENTION_PURGE",
            instance=document,
            summary=f"Purged expired clinical document: {document.title}",
            metadata={"checksum_sha256": document.checksum_sha256},
        )
        if document.file:
            document.file.delete(save=False)
        document.delete()
        purged += 1
    return purged
