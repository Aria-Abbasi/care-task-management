# Haven Care

Haven is a production-oriented, responsive care-management PWA. It emphasizes clear patient identity, large touch targets, safe medication recording, urgency, and a timeline-first caregiver workflow.

## Feature set

- Multi-patient care with explicit organization and assignment boundaries
- Versioned task outcomes, append-only corrections, and visible offline conflict resolution
- Medication five-right verification, clinician order approval, allergy/interaction blocking, PRN limits, late handling, barcode lookup, stock reconciliation, and refill requests
- In-app and background Web Push alerts with receipts, quiet hours, acknowledgement, snoozing, escalation chains, SMS/voice provider adapters, retries, and dead-letter review
- Historical vital trends, clinician-defined thresholds, provenance, care plans, diagnoses, allergies, contacts, advance directives, wound records, and secure attachments
- Persistent family/clinical messaging, urgent escalation, attachments/voice-note fields, mentions, and read receipts
- Shift assignments plus handover history and acknowledgement
- Expiring/rotating sessions, TOTP MFA, password reset, device management, remote revocation, abuse throttling, CSP, and strict production headers
- Caregiver, clinician, family, and administrator workspaces with organization administration
- Assignment-scoped HL7 FHIR R5 resources and an OpenAPI 3.1 contract
- Route-level code splitting, PWA offline shell, English/Persian direction, accessibility checks, visual regression, and safety E2E tests

## Run locally

Requirements: Node.js 18+, Python 3.12+, and the Python packages in `backend/requirements-dev.txt`.

```bash
.venv/bin/python backend/manage.py migrate
.venv/bin/python backend/manage.py seed_demo
.venv/bin/python backend/manage.py runserver
```

In another terminal:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Demo accounts are `sarah / caregiver`, `doctor / clinician-demo`, `layla / family-demo`, and `admin / admin-demo`. Vite proxies `/api` to Django in development.

## Offline behavior

- Selected patient dashboards expire locally after 24 hours; API and media responses are never placed in the public service-worker cache.
- Clinical mutations use unique replay references and are isolated by caregiver.
- Version conflicts remain visible until explicitly resolved. Records older than seven days stop for manual review rather than silently replaying.
- Sign-out is paused while unsynced changes remain and clears protected local data when complete.

## Verification

```bash
npm run lint
npm test
npm run build
.venv/bin/ruff check backend
.venv/bin/ruff format --check backend
.venv/bin/python backend/manage.py test apps
```

Playwright tests live in `e2e/`. `docker compose up --build` starts PostgreSQL, Redis, Django/Gunicorn, Celery workers, Celery Beat, and Nginx.

## Deployment and pilot evidence

Production VAPID and SMS/voice credentials must be supplied by the deploying organization. Live caregiver studies and jurisdiction-specific healthcare/privacy approval require real participants and qualified reviewers; this repository deliberately does not claim those external activities occurred.

- [Operations and restore runbook](docs/OPERATIONS.md)
- [Security, privacy, and retention baseline](docs/SECURITY_PRIVACY.md)
- [Caregiver usability protocol](docs/CAREGIVER_USABILITY_TEST.md)
- [Pilot release gate](docs/PILOT_RELEASE_GATE.md)
- [OpenAPI contract](docs/openapi.yaml)
- [Design system](docs/DESIGN_SYSTEM.md)

Reference baselines: [W3C Push API](https://www.w3.org/TR/push-api/), [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/), [Django deployment checklist](https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/), and [HL7 FHIR](https://hl7.org/fhir/overview.html).

See [backend/README.md](backend/README.md) for API details.
