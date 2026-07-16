# Haven Care

Haven is a responsive care-management PWA designed for busy caregivers. Its interface emphasizes large touch targets, urgency, and a timeline-first daily workflow.

## Included in this prototype

- Caregiver sign-in
- Today's task timeline with completion tracking
- Task detail and task creation workflows
- Weekly schedule and all-task views
- Medication schedules and adherence overview
- Health-vital charts and recent readings
- Shift handover reports
- Family and care-team messages
- Notification, privacy, and profile settings
- Responsive mobile navigation and offline shell caching

The interface authenticates against the Django REST backend and loads assignment-scoped patient tasks, medications, and vitals. Care actions are cached in IndexedDB and replayed automatically after connectivity returns.

## Run locally

Requirements: Node.js 18 or newer.

In one terminal:

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

Open `http://localhost:5173`. The seeded sign-in is pre-filled. Vite proxies `/api` to Django during development; set `VITE_API_URL` when the API is hosted separately.

## Offline behavior

- The latest dashboard is cached locally for offline access.
- Task completion, task creation, vital readings, and shift handovers use unique client references and an IndexedDB mutation queue.
- Queued changes replay in creation order when the browser reconnects.
- The sync indicator shows offline, pending, syncing, and synced states.
- Signing out while offline is blocked when unsynced clinical changes remain.
- Authenticated API responses are never written to the public service-worker cache.

## Verification

```bash
npm run lint
npm test
npm run build
```

The optimized build is written to `dist/`.

## Planned production services

- Django REST API with SQLite locally and PostgreSQL in production
- Celery and Celery Beat for occurrences and overdue processing
- Role-based users with explicit patient care assignments
- Message persistence, push notifications, and conflict-resolution tooling

See [`backend/README.md`](backend/README.md) for API setup, endpoints, demo data, and container instructions.
