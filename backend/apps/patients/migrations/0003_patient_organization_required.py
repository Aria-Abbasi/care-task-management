import django.db.models.deletion
from django.db import migrations, models


def assign_legacy_organization(apps, schema_editor):
    Organization = apps.get_model("accounts", "Organization")
    Patient = apps.get_model("patients", "Patient")
    if Patient.objects.filter(organization__isnull=True).exists():
        organization, _ = Organization.objects.get_or_create(
            slug="legacy-independent-care",
            defaults={"name": "Legacy independent care", "timezone": "UTC", "active": True},
        )
        Patient.objects.filter(organization__isnull=True).update(organization=organization)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_loginattempt_organization_user_mfa_confirmed_at_and_more"),
        ("patients", "0002_patient_organization"),
    ]

    operations = [
        migrations.RunPython(assign_legacy_organization, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="patient",
            name="organization",
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="patients", to="accounts.organization"),
        ),
    ]
