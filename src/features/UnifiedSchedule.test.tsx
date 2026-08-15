import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import UnifiedSchedule from './UnifiedSchedule'
import { filterScheduleOccurrences } from '../lib/schedule'
import type { Patient, Session, TaskOccurrence } from '../lib/types'

const occurrence = (id: number, status: TaskOccurrence['status']): TaskOccurrence => ({
  id,
  task: id,
  task_detail: { id, title: `Task ${id}` } as TaskOccurrence['task_detail'],
  schedule: null,
  scheduled_at: '2026-08-16T09:00:00Z',
  effective_scheduled_at: '2026-08-16T09:00:00Z',
  status,
  outcome: '',
  version: 1,
  completed_at: null,
  completed_by: null,
  delayed_until: null,
  completion: null,
  corrections: [],
  updated_at: '2026-08-16T08:00:00Z',
})

describe('care schedule status filters', () => {
  const items = [
    occurrence(1, 'PENDING'),
    occurrence(2, 'DELAYED'),
    occurrence(3, 'DONE'),
    occurrence(4, 'MISSED'),
    occurrence(5, 'SKIPPED'),
  ]

  it('maps each requested filter to the correct clinical states', () => {
    expect(filterScheduleOccurrences(items, 'completed').map((item) => item.id)).toEqual([3])
    expect(filterScheduleOccurrences(items, 'pending').map((item) => item.id)).toEqual([1, 2])
    expect(filterScheduleOccurrences(items, 'overdue').map((item) => item.id)).toEqual([4])
    expect(filterScheduleOccurrences(items, 'all')).toHaveLength(5)
  })

  it('renders bilingual, pressed-state status controls before calendar data loads', () => {
    const session = { token: 'test', user: { id: 1, role: 'CAREGIVER' } } as Session
    const patient = { id: 7, full_name: 'Maryam Abbasi' } as Patient
    const english = renderToStaticMarkup(<UnifiedSchedule session={session} patient={patient} selectedDate="2026-08-16" locale="en" onDate={vi.fn()} onRecordOccurrence={vi.fn()} onAdd={vi.fn()} />)
    const persian = renderToStaticMarkup(<UnifiedSchedule session={session} patient={patient} selectedDate="2026-08-16" locale="fa" onDate={vi.fn()} onRecordOccurrence={vi.fn()} onAdd={vi.fn()} />)

    expect(english).toContain('aria-label="Filter tasks by status"')
    expect(english).toContain('aria-pressed="true"')
    for (const label of ['All', 'Completed', 'Pending', 'Overdue']) expect(english).toContain(label)
    for (const label of ['همه', 'انجام‌شده', 'در انتظار', 'سررسید گذشته']) expect(persian).toContain(label)
  })
})
