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
| Delay an occurrence | `POST /api/v1/occurrences/{id}/delay/` |
| Medications | `/api/v1/medications/` |
| Dose logs | `/api/v1/dose-logs/` |
| Administer a dose | `POST /api/v1/dose-logs/{id}/administer/` |
| Vital records | `/api/v1/vitals/` |
| Shift handovers | `/api/v1/shift-reports/` |

All patient-owned querysets are restricted to explicit active care assignments. Administrators can access every active patient.

## Background work

Celery Beat invokes `maintain_task_occurrences` every minute. The task idempotently creates calendar occurrences and marks stale pending occurrences as missed.

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
.venv/bin/python backend/manage.py test apps.care_tasks
```

## Containers

`compose.yaml` starts PostgreSQL, Redis, the API, a Celery worker, and Celery Beat:

```bash
docker compose up --build
```

Replace the example credentials and secret key before using the compose configuration outside local development.
