# Real caregiver pilot release gate

The repository is technically prepared for facilitated sessions, but actual caregiver sessions cannot be represented as complete until named participants perform the protocol in `CAREGIVER_USABILITY_TEST.md` and signed evidence is stored outside the source repository.

Release is blocked by any wrong-patient action, misunderstood critical alert, skipped medication-right confirmation, unsafe correction, unresolved offline conflict, inaccessible critical path, or facilitator intervention needed to avoid harm. Fix the issue, add an automated regression where possible, and repeat the affected scenario with caregivers.

Required evidence:

- participant role and experience band, with consent and no unnecessary identity data;
- device, browser, locale, assistive technology, and network conditions;
- scenario result, observed errors, time-on-task, and direct severity rating;
- finding owner, remediation commit, retest date, and disposition;
- clinical safety lead, accessibility reviewer, privacy reviewer, and product owner sign-off;
- backup restore result, load-test result, alert-delivery drill, and rollback drill.

Do not use production patient data in usability or load testing. A completed checklist without observed session evidence is not approval.
