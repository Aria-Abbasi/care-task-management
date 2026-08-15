from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("care_tasks", "0004_task_equipment_task_expected_outcome_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="caretasktemplate",
            name="requires_note",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="caretasktemplate",
            name="requires_photo",
            field=models.BooleanField(default=False),
        ),
    ]
