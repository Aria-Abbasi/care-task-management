import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DoseModal, PrnModal, TaskModal } from './App'
import { TaskBuilder } from './features/TaskBuilder'
import HealthView from './features/HealthView'
import ReportsView from './features/ReportsView'
import type { DoseLog, Medication, Patient, Session } from './lib/types'

const patient: Patient = {
  id: 7,
  first_name: 'Maryam',
  last_name: 'Abbasi',
  full_name: 'Maryam Abbasi',
  birth_date: '1948-06-04',
  age: 78,
  gender: 'FEMALE',
  room: '205',
  medical_notes: '',
  photo: null,
  active: true,
}

describe('safe caregiver dialogs', () => {
  it('identifies the patient and exposes an accessible guided task builder', () => {
    const markup = renderToStaticMarkup(
      <TaskBuilder patient={patient} token="test-token" existingTitles={['Hydration check']} onClose={vi.fn()} onCreate={vi.fn()} />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="task-builder-title"')
    expect(markup).not.toContain('Hassan')
    expect(markup).toContain('Maryam Abbasi')
    expect(markup).toContain('Task creation progress')
    expect(markup).toContain('Start from a care template')
  })

  it('names the selected patient and exposes an accessible task-outcome dialog', () => {
    const task = {
      id: 12,
      taskId: 3,
      time: '09:30',
      title: 'Blood pressure check',
      detail: 'Due now',
      category: 'health',
      status: 'now',
      instructions: 'Allow five minutes of rest.',
      occurrence: {
        id: 12,
        task: 3,
        task_detail: {} as never,
        schedule: 1,
        scheduled_at: '2026-07-16T09:30:00Z',
        effective_scheduled_at: '2026-07-16T09:30:00Z',
        status: 'PENDING',
        outcome: '',
        version: 1,
        completed_at: null,
        completed_by: null,
        delayed_until: null,
        completion: null,
        corrections: [],
        updated_at: '2026-07-16T09:00:00Z',
      },
    } as ComponentProps<typeof TaskModal>['task']
    const markup = renderToStaticMarkup(<TaskModal task={task} patient={patient} onClose={vi.fn()} onSave={vi.fn()} />)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('Maryam Abbasi')
    expect(markup).toContain('Care outcome')
    expect(markup).toContain('I confirmed this care record is for')
  })

  it('renders all five medication checks before a scheduled dose can be given', () => {
    const dose: DoseLog = {
      id: 9,
      medication: 2,
      medication_name: 'Amlodipine',
      patient: patient.id,
      patient_name: patient.full_name,
      dose: '5.00',
      unit: 'mg',
      route: 'Oral',
      scheduled_at: '2026-07-16T08:00:00Z',
      status: 'SCHEDULED',
      version: 1,
      administered_at: null,
      administered_by_name: null,
      note: '',
      verified_patient: false,
      verified_medication: false,
      verified_dose: false,
      verified_route: false,
      verified_time: false,
      was_late: false,
      late_minutes: 0,
      timing_status: 'ON_TIME',
      timing_variance_minutes: 0,
      timing_window_minutes: 30,
      timing_reason: '',
      is_prn: false,
      corrections: [],
      updated_at: '2026-07-16T07:00:00Z',
    }
    const markup = renderToStaticMarkup(<DoseModal dose={dose} patient={patient} onClose={vi.fn()} onSave={vi.fn()} />)

    for (const label of ['Right patient', 'Right medication', 'Right dose', 'Right route', 'Right time']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Confirm before administration')
  })

  it('renders all five medication checks for a PRN administration', () => {
    const medication = { id: 3, name: 'Paracetamol', dose: '500', unit: 'mg', route: 'Oral', prn_reason: 'Pain' } as Medication
    const markup = renderToStaticMarkup(<PrnModal medication={medication} patient={patient} onClose={vi.fn()} onSave={vi.fn()} />)
    for (const label of ['Right patient', 'Right medication', 'Right dose', 'Right route', 'Right time']) expect(markup).toContain(label)
    expect(markup).toContain('Reason and assessment')
  })

  it('keeps health and handovers read-only for family accounts', () => {
    const session = { token: 'test', user: { id: 5, role: 'FAMILY' } } as Session
    const health = renderToStaticMarkup(<HealthView session={session} patient={patient} latest={[]} onRecord={vi.fn()} canRecord={false} />)
    const reports = renderToStaticMarkup(<ReportsView session={session} patient={patient} taskCount={0} vitalCount={0} onSend={vi.fn()} notify={vi.fn()} canAuthor={false} />)
    expect(health).not.toContain('Record vital')
    expect(reports).not.toContain('Send handover')
    expect(reports).toContain('Read-only family view')
  })

  it('shows task details without care-recording controls to family accounts', () => {
    const task = {
      id: 12,
      taskId: 3,
      time: '09:30',
      title: 'Blood pressure check',
      detail: 'Due now',
      category: 'health',
      status: 'now',
      instructions: 'Allow five minutes of rest.',
      occurrence: {
        id: 12,
        task: 3,
        task_detail: { priority: 'HIGH', equipment: [], corrections: [] } as never,
        schedule: 1,
        scheduled_at: '2026-07-16T09:30:00Z',
        effective_scheduled_at: '2026-07-16T09:30:00Z',
        status: 'PENDING',
        outcome: '',
        version: 1,
        completed_at: null,
        completed_by: null,
        delayed_until: null,
        completion: null,
        corrections: [],
        updated_at: '2026-07-16T09:00:00Z',
      },
    } as ComponentProps<typeof TaskModal>['task']
    const markup = renderToStaticMarkup(
      <TaskModal task={task} patient={patient} canRecord={false} onClose={vi.fn()} onSave={vi.fn()} />,
    )

    expect(markup).toContain('Family read-only view')
    expect(markup).not.toContain('Care outcome')
    expect(markup).not.toContain('Record outcome')
    expect(markup).not.toContain('Delay or skip this occurrence')
  })
})
