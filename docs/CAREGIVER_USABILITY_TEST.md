# Caregiver usability test

This protocol validates Haven's Safe Care Execution workflow with representative caregivers. Automated tests verify labels, dialog semantics, identity prompts, five-right medication checks, conflict retention, and API safety rules; the facilitated sessions below are still required before a real clinical pilot.

## Participants and environment

- Recruit at least five caregivers for each materially different user group: professional caregiver, family caregiver, and clinical supervisor.
- Include participants with low digital confidence, corrected vision, and reduced hand dexterity.
- Use a phone and a desktop at realistic text sizes. Repeat critical scenarios with weak connectivity, background noise, interruptions, and one-handed use.
- Use synthetic patient and medication data only. Never test with real protected health information.

## Safety-critical scenarios

1. Switch from Hassan to Maryam and confirm which patient is active from the persistent identity areas.
2. Record a completed care task with a useful note.
3. Record “unable to complete” and identify the required explanation.
4. Correct an outcome entered for the wrong time slot and confirm the original record remains visible.
5. Give a scheduled medication after independently checking patient, medicine, dose, route, and time.
6. Record a held or refused medication with a reason, then correct that record.
7. Find an overdue alert, explain its severity, snooze it, and later acknowledge it.
8. Complete a task offline, simulate a stale server version, find the conflict, and choose the safe next action.
9. Navigate every critical workflow with a keyboard and at 200% browser zoom.
10. Sign out with an unsynchronized clinical action and explain why Haven blocks the operation.

## Pass criteria

- 100% of participants identify the active patient before task completion or medication administration.
- 100% of medication scenarios include all five confirmations without facilitator prompting.
- No participant silently overwrites or accidentally discards a conflict.
- At least 90% of non-critical tasks are completed without assistance.
- Critical task completion should take under 60 seconds after the caregiver has the required information.
- Every participant can explain the difference between acknowledge, snooze, correct, retry, and discard.
- No unresolved critical accessibility defect blocks keyboard, screen-reader, zoomed, or reduced-motion use.

Any wrong-patient action, duplicate dose, hidden conflict, irreversible correction, or misunderstood critical alert is a release blocker regardless of aggregate completion rate.

## Observation sheet

For each scenario record: completion, time, assistance, navigation errors, recovery, confidence (1–5), and any close call. Do not coach during the first attempt. Afterward ask the participant to describe what they expected, what felt unsafe, and what they would need during a busy shift.

## Automated checks

Run before every facilitated session:

```bash
npm run lint
npm test
npm run build
.venv/bin/ruff check backend
.venv/bin/python backend/manage.py check
.venv/bin/python backend/manage.py test apps.care_tasks
```

Record browser/screen-reader versions, test date, commit hash, participants, findings, severity, owner, and retest status in the study report.
