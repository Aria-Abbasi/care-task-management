from django.contrib import admin

from .models import AdvanceDirective, Allergy, CarePlan, ClinicalDocument, Diagnosis, EmergencyContact, VitalThreshold, WoundRecord

for model in [Allergy, Diagnosis, CarePlan, EmergencyContact, AdvanceDirective, ClinicalDocument, WoundRecord, VitalThreshold]:
    admin.site.register(model)
