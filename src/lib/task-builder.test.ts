import { describe, expect, it } from 'vitest'

import { previewOccurrences, scheduleSummary, type TaskCreationDraft } from './task-builder'

const schedule = (overrides: Partial<TaskCreationDraft['schedule']> = {}): TaskCreationDraft['schedule'] => ({
  frequency: 'DAILY',
  time: '09:30',
  specific_date: null,
  interval_hours: null,
  days_of_week: [],
  event_reference: '',
  window_before_minutes: 0,
  window_after_minutes: 30,
  starts_on: '2026-07-20',
  ends_on: null,
  ...overrides,
})

describe('task builder schedule helpers', () => {
  it('summarizes weekly days and the safe completion window', () => {
    expect(scheduleSummary(schedule({ frequency: 'WEEKLY', days_of_week: [1, 3, 5] }))).toContain(
      'Mon, Wed, Fri at 09:30',
    )
    expect(scheduleSummary(schedule())).toContain('window 0 min before / 30 min after')
  })

  it('previews interval occurrences from the selected first time', () => {
    const preview = previewOccurrences(schedule({ frequency: 'INTERVAL', time: '06:00', interval_hours: 6 }), 3)
    expect(preview.map((item) => item.getHours())).toEqual([6, 12, 18])
  })

  it('respects weekly recurrence and end dates', () => {
    const preview = previewOccurrences(
      schedule({ frequency: 'WEEKLY', days_of_week: [1], starts_on: '2026-07-20', ends_on: '2026-07-27' }),
    )
    expect(preview.map((item) => item.toISOString().slice(0, 10))).toEqual(['2026-07-20', '2026-07-27'])
  })
})

