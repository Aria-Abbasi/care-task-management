# Haven API

Django REST backend for Haven's caregiver PWA. It uses SQLite for zero-configuration local development and PostgreSQL when `HAVEN_DATABASE_URL` is set.

## Local setup

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/python backend/manage.py migrate
.venv/bin/python backend/manage.py seed_demo
.venv/bin/python backend/manage.py runserver
```

The API is available at `http://localhost:8000/api/v1/`. The seeded caregiver is:

- Login: `sarah@havencare.com`
- Password: `caregiver`

The seed credentials are for local development only.

Additional role workspaces are `doctor / clinician-demo`, `layla / family-demo`, and `admin / admin-demo`.

## Authentication

Create an API token by posting to the login endpoint:

```http
POST /api/v1/auth/login/
Content-Type: application/json

{"login":"sarah@havencare.com","password":"caregiver"}
```

Send the returned token with subsequent requests:

```http
Authorization: Token <token>
```

## Main resources

| Resource | Endpoint |
| --- | --- |
| Current user | `GET /api/v1/auth/me/` |
| Patients | `/api/v1/patients/` |
| Daily dashboard | `GET /api/v1/patients/{id}/dashboard/?date=YYYY-MM-DD` |
| Tasks and nested schedules | `/api/v1/tasks/` |
| Task occurrences | `/api/v1/occurrences/` |
| Complete an occurrence | `POST /api/v1/occurrences/{id}/complete/` |
| Correct an occurrence | `POST /api/v1/occurrences/{id}/correct/` |
| Delay an occurrence | `POST /api/v1/occurrences/{id}/delay/` |
| Medications | `/api/v1/medications/` |
| Dose logs | `/api/v1/dose-logs/` |
| Administer a dose | `POST /api/v1/dose-logs/{id}/administer/` |
| Record a non-given dose | `POST /api/v1/dose-logs/{id}/outcome/` |
| Correct a dose | `POST /api/v1/dose-logs/{id}/correct/` |
| Care alerts | `/api/v1/notifications/` |
| Refresh overdue alerts | `POST /api/v1/notifications/refresh/` |
| Audit history | `GET /api/v1/audit-events/` |
| Vital records | `/api/v1/vitals/` |
| Shift handovers | `/api/v1/shift-reports/` |
| Conversations and messages | `/api/v1/conversations/`, `/api/v1/messages/` |
| Clinical record | `/api/v1/allergies/`, `/api/v1/diagnoses/`, `/api/v1/care-plans/`, `/api/v1/emergency-contacts/`, `/api/v1/advance-directives/`, `/api/v1/clinical-documents/`, `/api/v1/wound-records/` |
| Notification delivery | `/api/v1/notification-preferences/`, `/api/v1/push-subscriptions/`, `/api/v1/notification-deliveries/` |
| Escalation policy | `/api/v1/escalation-policies/`, `/api/v1/escalation-steps/` |
| Session security | `/api/v1/sessions/`, `/api/v1/mfa/`, `/api/v1/auth/rotate/`, `/api/v1/auth/password-reset/` |
| FHIR R5 exchange | `/api/v1/fhir/metadata/`, `/api/v1/fhir/{resourceType}/` |

All patient-owned querysets are restricted to explicit active care assignments. Administrators can access every active patient.

Task templates, task completions, dose outcomes, corrections, vital readings, and shift reports accept a unique `client_reference`. Replaying the same offline mutation returns the existing record instead of duplicating clinical data. Task occurrences and dose logs also use `expected_version`; stale writes return HTTP 409 with the current server state.

## Background work

Celery Beat invokes occurrence maintenance and overdue-care scanning every minute. The tasks idempotently create task occurrences and dose logs, mark stale care as missed, generate assigned-caregiver alerts, and increase escalation severity at 60 and 120 minutes overdue.

```bash
.venv/bin/celery -A config --workdir backend worker --loglevel=info
.venv/bin/celery -A config --workdir backend beat --loglevel=info
```

Redis is required for the worker and beat processes.

## Tests and quality checks

```bash
.venv/bin/ruff check backend
.venv/bin/ruff format --check backend
.venv/bin/python backend/manage.py check
.venv/bin/python backend/manage.py test apps
```

## Containers

`compose.yaml` starts PostgreSQL, Redis, the API, a Celery worker, and Celery Beat:

```bash
docker compose up --build
```

Replace every example secret outside local development. Configure VAPID, SMS/voice, TLS, monitoring, backup storage, and delivery receipts using `docs/OPERATIONS.md`.
