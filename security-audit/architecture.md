# Haven security architecture and threat model

Audit date: 2026-08-09
Target: `/home/Aria/Documents/Care task managment`
Method: source-assisted, read-only security review with controlled local validation

## System purpose and sensitivity

Haven is a bilingual English/Persian care-management PWA. It coordinates patients, caregivers, clinicians, family members, and organization administrators. The application stores patient identity data, care tasks, medication orders and administration history, vital signs, diagnoses, allergies, care plans, clinical documents, wound images, messages, shift reports, alerts, audit records, and staff availability. It is safety-sensitive: unauthorized data access is harmful, and unauthorized or incorrect changes can also affect medication and care delivery.

Haven is not a diagnostic engine. It is a workflow, communication, and clinical-record system. Its documented security target is OWASP ASVS 5.0 Level 2 plus Django's deployment guidance.

## Runtime architecture

```text
Caregiver / clinician / family / admin browser
    | HTTPS; bearer token or Django session
    v
Nginx (static React PWA and reverse proxy)
    | /api and /health
    v
Gunicorn / Django REST Framework
    |-- PostgreSQL (SQLite for local development)
    |-- Redis cache and Celery broker/result store
    |-- protected filesystem media volume
    |-- Celery workers and Celery Beat
    |     |-- Web Push providers
    |     |-- Twilio SMS/voice
    |     `-- email/Sentry
    `-- FHIR R5 read/search API
```

The React client stores a bearer-equivalent session token in `localStorage` or `sessionStorage`, selected workspace state in local storage, and time-limited patient dashboards plus pending mutations in IndexedDB. A service worker caches only non-API, non-media, non-authenticated GET requests and handles Web Push notifications and delivery receipts.

The Django API uses a custom hashed, expiring, revocable session-token model and also enables Django session authentication. Background jobs maintain task occurrences, scan overdue care, dispatch notifications, purge retained clinical documents, and purge expired security records.

## Principal assets

1. Patient health and identity data: demographics, rooms, medical notes, diagnoses, allergies, vital signs, care plans, documents, wound images, and emergency information.
2. Medication safety data: orders, approval state, schedules, dose logs, five-right verification, PRN history, contraindications, interactions, stock, and refill records.
3. Care operations: tasks, occurrences, completion/correction history, schedules, shifts, handovers, reports, alerts, and escalation ownership.
4. Communications: patient-specific conversations, messages, attachments, voice notes, mentions, and read state.
5. Authentication material: password hashes, session-token hashes, MFA secrets, password-reset tokens, browser-stored bearer tokens, Web Push keys, and device/session metadata.
6. Tenant and authorization data: organizations, roles, patient assignments, conversation participants, caregiver availability, escalation policies, and recipient configuration.
7. Evidentiary records: append-oriented audit events, correction history, notification deliveries, receipts, dead letters, and signed audit exports.
8. Operational secrets and availability: Django secret key, database/Redis credentials, VAPID/Twilio/email/Sentry configuration, backups, worker heartbeats, and deployment health.

## Actors and intended authority

| Actor | Intended authority | Important exclusions |
|---|---|---|
| Anonymous internet user | Login, password-reset request/confirmation, liveness/readiness, schema, correctly authenticated provider receipts | No patient or organization data; no state changes outside valid reset/receipt flows |
| Family member | Narrow read-oriented access to explicitly assigned patients, approved updates, reports, health, timeline, and conversations | No clinical ordering, medication administration, care completion, or tenant administration |
| Caregiver | Assigned-patient care workspace, task and dose recording, vitals, shifts, messages, reports, offline reconciliation | No unassigned patient access, medication-order approval, or tenant administration |
| Clinician/doctor | Assigned-patient clinical review and authoring, medication ordering/approval, clinical records | No unassigned patient access or unrelated organization administration |
| Organization administrator | Users, patients, assignments, templates, staffing, escalation, and operational oversight inside the administrator's organization | No ordinary cross-organization access |
| Django superuser/operator | Platform-wide administrative and deployment authority | This is deliberately higher trust and must be tightly controlled |
| Background worker | Fixed maintenance and delivery tasks using application/database privileges | Broker publishers and provider callbacks must not gain arbitrary application authority |
| Push/Twilio/email provider | Deliver a preconstructed, non-PHI notification and return a receipt | No general API or patient-record authority |
| FHIR client | Authenticated, role/assignment-scoped read/search access | No cross-patient search or write access |
| Local device user/malware | Holds whatever offline data and browser session the signed-in user placed on that device | Endpoint compromise is partly outside the web trust boundary, but retention and logout behavior remain relevant |

## Trust boundaries

1. **Public network to Nginx/Django.** All public routes, headers, bodies, multipart files, identifiers, and provider callbacks are attacker-controlled until authenticated and validated.
2. **Authentication to application identity.** Password, MFA, reset, token rotation, expiry, revocation, inactive account, and inactive organization checks establish the caller's identity and continued eligibility.
3. **Organization boundary.** Ordinary admins and users must remain inside their organization. Superuser cross-tenant authority is intentional.
4. **Patient-assignment boundary.** Patient access is narrower than organization membership for caregivers, clinicians, and family users. Every related object and custom action must derive authority from the patient, not merely from supplied foreign keys.
5. **Role and clinical-action boundary.** Read, authoring, approval, administration, correction, stock, and administrative powers differ by role. Clinical corrections must not become a less-protected alternate execution path.
6. **Conversation-participant boundary.** Organization/patient access and explicit participation govern message access and attachments. Writable relationship fields must not move content across these boundaries.
7. **Browser/offline boundary.** Bearer tokens and cached PHI reside on the device; queued paths/bodies later re-enter the API. Server authorization and concurrency controls must be identical for online and replayed requests.
8. **File/media boundary.** User files cross parsers and storage and are later downloaded by authorized users. Size, format, storage name, response disposition, authorization, and retention are relevant.
9. **Application to outbound provider boundary.** Stored push endpoints and configured provider URLs cause server-side network activity. Notification contents must avoid PHI; callback authentication must bind receipts to the right delivery.
10. **Django/Celery to Redis/PostgreSQL/media.** These internal services carry high-value data and commands. Network exposure, credentials, broker trust, database constraints, and transactionality are relevant.
11. **Application to monitoring/backups.** Logs, Sentry events, metrics, backups, and error fields must not leak credentials or excessive patient data and must retain integrity and availability.
12. **Source/configuration to deployment.** Checked-in defaults, demo seed behavior, environment validation, debug behavior, secure proxy settings, headers, and published ports determine whether development assumptions can reach production.

## External and user-controlled input surfaces

- Public authentication, password reset, provider receipt, health, metrics, schema, and Django admin routes.
- DRF resource identifiers, filters, searches, ordering, pagination, JSON bodies, relationship IDs, custom actions, and FHIR resource/patient selectors.
- Patient and medication images; task completion photos; clinical documents; wound photos; message attachments and voice notes.
- Web Push endpoint URL, encryption keys, device name, and provider response data.
- Browser local/session storage, IndexedDB queue contents, URL/reset parameters, camera/microphone/file inputs, service-worker push payloads, and notification-click URLs.
- Environment variables for database, Redis, CORS, hosts, TLS, provider credentials, public URLs, metrics protection, and logging.
- Celery broker messages and operator-supplied backup/restore/deployment script arguments.

## Security controls observed

- Default API authentication and `IsAuthenticated` authorization.
- Hashed opaque session tokens with expiry and revocation; token rotation and session/device revocation endpoints.
- TOTP MFA and password reset/change flows.
- Central patient visibility helper combining organization and active assignment.
- Role-specific backend permissions and patient-scoped querysets in most domain viewsets.
- Optimistic versions and idempotency identifiers on safety-sensitive task/dose actions.
- Atomic medication administration/stock operations and audit/correction records.
- CORS allowlist, CSRF-aware Django session authentication, CSP, frame denial, nosniff, HSTS/secure-cookie production settings, and Nginx denial of direct media access.
- React's default text escaping; no raw-HTML rendering sink was found during reconnaissance.
- ORM-based database access; no request-controlled raw SQL or web-to-shell execution path was found during reconnaissance.
- Protected media downloads, document retention jobs, bounded calendar ranges, fixed provider message templates, and notification bodies designed to omit PHI.
- Health/worker monitoring, delivery records, dead-letter state, backups, and signed audit export.

These are observed controls, not conclusions that every route applies them correctly.

## Threat scenarios and audit priorities

1. A lower-privileged authenticated user changes a relationship field or calls a custom action to read or modify another patient, organization, conversation, shift, clinical record, alert, or audit record (IDOR/BOLA and tenant escape).
2. A user reaches a privileged clinical outcome through a correction, import, offline replay, or state-transition path that enforces fewer safeguards than the primary workflow.
3. A stolen but still-valid session is converted into persistent account control by changing credentials, MFA, recovery, or profile state without reauthentication.
4. Deactivated users or organizations retain working sessions, or revocation/rotation races leave valid credentials behind.
5. Public login/reset/receipt/health/metrics behavior enables denial of service, enumeration, forged delivery state, or operational information disclosure.
6. A stored Push endpoint causes server-side requests to an unintended network target, or callback identifiers allow cross-delivery manipulation.
7. A malicious upload causes parser resource exhaustion, content confusion, unauthorized download, path manipulation, stored active content, or retention failure.
8. Cross-site requests or browser script execution abuse session authentication, bearer storage, IndexedDB clinical data, or offline mutation replay.
9. Query/filter/FHIR inputs cause injection, unconstrained enumeration, excessive work, or data access not represented in ordinary resource endpoints.
10. Demo secrets, checked-in databases, insecure environment defaults, trusted-proxy mistakes, published internal services, or deployment drift expose production data or availability.
11. Dependency vulnerabilities are reachable through used application features and provide a realistic attack path.
12. Clinical audit, notification, or signed-export behavior can be suppressed, falsified, replayed, or reassigned such that safety history becomes misleading.

## Security baseline and severity model

The review uses an OWASP ASVS 5.0 Level 2-style baseline, Django/DRF security expectations, and the stricter safety expectations of a multi-tenant care/eMAR platform. In particular:

- Tenant or unassigned-patient confidentiality/integrity failures are normally High when realistic.
- Unauthorized medication administration, order, or safety-history changes can be High even without traditional code execution because downstream care decisions rely on them.
- Account takeover from an already stolen authenticated session is rated by the incremental persistence/privilege impact and required session strength, not as if the attacker began unauthenticated.
- Availability issues require a credible shared-resource or operational impact; ordinary per-user failure is not automatically a vulnerability.
- Missing best practices without a demonstrated attack path are recorded only as hardening recommendations.

## Audit assumptions and constraints

- The source tree and declared Docker/Nginx topology are in scope. The live `care.kobi.rest` deployment is not actively tested by this review.
- Controlled dynamic validation will use local disposable test state, not the deployed server or real patient records.
- Possession of a legitimate lower-privilege account is an acceptable prerequisite when evaluating tenant, patient, or role isolation.
- Full compromise of an authorized endpoint device, database, Redis broker, deployment host, Django superuser, or provider account is not treated as a web vulnerability by itself; failures that unnecessarily amplify such compromise may be hardening findings.
- Product-controlled demo data is not presumed to be real patient data. Checked-in data will be evaluated for actual sensitivity before being reported.
- Intentional family access, superuser cross-tenant access, offline device storage, and non-PHI provider notifications are not vulnerabilities merely because they create exposure; implementation failures around those choices remain in scope.
- Exact findings require an attacker-controlled source, a security-relevant sink or invariant failure, prerequisites, realistic impact, and reproducible evidence. Speculative candidates are rejected or listed as hardening only.

## Reconnaissance coverage

The initial inventory covered the frontend entry points and storage, all registered Django/DRF routes and custom actions, authentication and role models, patient visibility, domain serializers/viewsets, uploads/downloads, FHIR, service worker, Celery tasks, outbound providers, operational endpoints, environment/deployment configuration, backup scripts, database access patterns, and dangerous-sink searches. Phase 2 performs focused vulnerability hunting; later phases independently challenge and reproduce every candidate before reporting it.
