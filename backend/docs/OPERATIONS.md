# Haven production operations

The production topology is PostgreSQL + Redis + Django/Gunicorn + Celery worker + Celery Beat + Nginx. `compose.yaml` is a reproducible pilot environment; production secrets belong in a managed secret store, never the compose file.

## Monitoring and alerts

- `/health/live/` proves the API process responds.
- `/health/ready/` checks the database, cache, overdue scanner heartbeat, and notification dispatcher heartbeat. Page the on-call operator if it is non-200 for two minutes.
- `/metrics/` reports notifications by delivery status and worker heartbeat age; protect it with `HAVEN_METRICS_TOKEN` outside a private network.
- JSON logs include request IDs. Set `HAVEN_SENTRY_DSN` for error tracking without default PII.
- Alert when `scan_overdue_care` or `dispatch_pending_notifications` heartbeat age exceeds 180 seconds, dead-letter count rises, database connections saturate, or p95 API latency exceeds 750 ms.

## Backups, restore and rollback

Run `scripts/backup.sh` on a protected schedule, encrypt the resulting PostgreSQL custom-format dump, and copy it to immutable regional storage. Run `scripts/verify-restore.sh` at least monthly against a disposable database and retain the evidence. `scripts/deploy.sh` takes a pre-deploy backup, migrates, checks readiness, and restores the previous image tag if readiness fails.

## Notifications

Configure VAPID public/private keys, Twilio credentials, sender phone number, public API URL, and a random delivery webhook secret of at least 24 characters. Provider callbacks update delivery receipts. Failed deliveries use exponential retry and then enter `DEAD`; an administrator can safely requeue them. Message bodies sent through push/SMS/voice deliberately contain no patient name or clinical detail.

## Load and concurrency

Run `k6 run -e HAVEN_LOAD_USER=... -e HAVEN_LOAD_PASSWORD=... scripts/load-test.js` against staging. Use synthetic accounts and data only. The pilot gate is less than 1% failures and p95 below 750 ms with 100 simultaneous caregivers. Test duplicate offline client references and version conflicts separately.
