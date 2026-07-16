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

The interface currently uses local demo data. A production-oriented Django REST backend is available in [`backend/`](backend/) and is ready for frontend API integration.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The demo sign-in accepts the pre-filled values.

## Verification

```bash
npm run lint
npm run build
```

The optimized build is written to `dist/`.

## Planned production services

- Django REST API with SQLite locally and PostgreSQL in production
- Celery and Celery Beat for occurrences and overdue processing
- Role-based users with explicit patient care assignments
- IndexedDB mutation queue and authenticated sync API

See [`backend/README.md`](backend/README.md) for API setup, endpoints, demo data, and container instructions.
