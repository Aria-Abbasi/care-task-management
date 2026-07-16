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

The current data is intentionally local demo data. The interface is structured so that a Django REST API can replace it in the next implementation phase.

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

- Django REST API with PostgreSQL
- Celery and Celery Beat for occurrences, reminders, and overdue alerts
- Role-based access for administrators, caregivers, doctors, and family members
- IndexedDB mutation queue and authenticated sync API
