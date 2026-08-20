# Security, privacy and retention baseline

Use OWASP ASVS 5.0 level 2 and Django's deployment checklist as verification baselines. The implementation includes expiring/rotating hashed session tokens, TOTP MFA, password reset, device inventory and revocation, generic login responses, abuse throttling, organization boundaries, assignment boundaries, CSP and production security headers, structured audit records, signed audit export, and non-PHI external notifications.

## Offline data

The service worker never caches API or media responses. IndexedDB dashboards expire after 24 hours. Unsynced clinical mutations older than seven days are stopped for explicit review rather than silently replayed or deleted. Sign-out removes local clinical data and remote session revocation blocks API access. Production device policy must require full-disk encryption, screen lock, managed browser storage, and remote device wipe; Web Crypto alone cannot protect data from code executing in the same compromised browser origin.

## Retention and deletion

Before pilot, the organization must approve a jurisdiction-specific schedule for patient records, attachments, messages, audit events, security logs, delivery receipts, and backups. `ClinicalDocument.retention_until` and the daily purge worker enforce approved document expiry. Legal hold must override deletion. Deletion jobs must record counts and identifiers in the audit log without copying deleted content. Backup expiry must mirror the approved schedule.

## Required human review

Privacy counsel and a healthcare compliance lead must document applicable rules for every operating region, data residency, breach notification, processor agreements, consent, family access, minors/incapacity, data-subject rights, clinical record retention, and whether the deployment is regulated as a medical device. This repository provides controls and evidence hooks; it is not a legal determination or certification.

Record ASVS results, threat-model findings, dependency scans, penetration-test remediation, restore evidence, and regional sign-off in the release evidence folder. Any unresolved high-severity issue blocks pilot release.
