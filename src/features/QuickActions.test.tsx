import 'fake-indexeddb/auto'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Dashboard } from '../App'
import { TaskBuilder } from './TaskBuilder'
import { formatCount } from '../lib/i18n'
import {
  cacheQuickTemplates,
  clearOfflineData,
  listMutations,
  pendingMutationCount,
  queueMutation,
  readCachedQuickTemplates,
  removeMutation,
} from '../lib/offline'
import { quickLogAdHocAction, undoQuickLogAction } from '../lib/api'
import type { AdHocQuickTemplate, ApiUser, Patient, Session } from '../lib/types'

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

const user: ApiUser = {
  id: 1,
  username: 'layla',
  email: 'layla@haven.local',
  phone: null,
  first_name: 'Layla',
  last_name: 'Caregiver',
  display_name: 'Layla Caregiver',
  role: 'CAREGIVER',
  is_active: true,
  organization: 1,
  organization_name: 'Haven Health',
  mfa_enabled: false,
}

const session: Session = {
  token: 'test-token',
  session_id: 123,
  expires_at: '2099-01-01T00:00:00Z',
  user,
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await clearOfflineData()
})

describe('Standardized Ad-Hoc Quick Actions & Dual-Column Dashboard', () => {
  it('renders dual-column layout with scheduled care and quick actions card', () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        tasks={[]}
        patient={patient}
        user={user}
        locale="en"
        vitals={[]}
        session={session}
        onTask={vi.fn()}
        onComplete={vi.fn()}
        onAdd={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    expect(markup).toContain('today-dual-columns')
    expect(markup).toContain('scheduled-care-column')
    expect(markup).toContain('quick-actions-column')
    expect(markup).toContain('Quick Care Actions')
    expect(markup).toContain('Standardized unscheduled care')
    expect(markup).toContain('Custom care action')
  })

  it('renders Persian translations for dashboard and quick actions when locale is fa', () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        tasks={[]}
        patient={patient}
        user={user}
        locale="fa"
        vitals={[]}
        session={session}
        onTask={vi.fn()}
        onComplete={vi.fn()}
        onAdd={vi.fn()}
        onNavigate={vi.fn()}
      />,
    )

    expect(markup).toContain('اقدامات سریع و پرتکرار')
    expect(markup).toContain('مراقبت‌های استاندارد بدون برنامه')
    expect(markup).toContain('اقدام مراقبتی سفارشی')
  })

  it('formats quick action counts with Persian numerals when locale is fa without middle dot', () => {
    expect(formatCount(1, 'en')).toBe('1×')
    expect(formatCount(3, 'en')).toBe('3×')
    expect(formatCount(1, 'fa')).toBe('۱×')
    expect(formatCount(5, 'fa')).toBe('۵×')
  })

  it('includes pinned quick action toggle in TaskBuilder step 0 (Task Details)', () => {
    const markup = renderToStaticMarkup(
      <TaskBuilder
        patient={patient}
        token="test-token"
        existingTitles={[]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        locale="en"
        initialStep={0}
      />,
    )

    expect(markup).toContain('Save as Pinned Quick Action on Today Dashboard')
  })

  it('includes localized Persian pinned quick action toggle in TaskBuilder step 0', () => {
    const markup = renderToStaticMarkup(
      <TaskBuilder
        patient={patient}
        token="test-token"
        existingTitles={[]}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        locale="fa"
        initialStep={0}
      />,
    )

    expect(markup).toContain('ذخیره به عنوان اقدام سریع در صفحه امروز')
  })

  it('dispatches quickLogAdHocAction with client reference and receives result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 55,
          status: 'DONE',
          outcome: 'COMPLETED',
          version: 1,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const clientRef = 'test-client-ref-123'
    const result = await quickLogAdHocAction('test-token', 1, 10, 7, 'Hydration', clientRef)

    expect(result.queued).toBe(false)
    expect(result.data?.id).toBe(55)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/ad-hoc-templates/10/log/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          patient_id: 7,
          note: 'Hydration',
          client_reference: clientRef,
        }),
      }),
    )
  })

  it('supports offline undo by removing mutation from IndexedDB queue without server call', async () => {
    const clientRef = 'offline-mutation-ref-99'
    await queueMutation({
      id: clientRef,
      userId: 1,
      path: '/ad-hoc-templates/10/log/',
      method: 'POST',
      body: { patient_id: 7, note: 'Water', client_reference: clientRef },
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    })

    expect(await pendingMutationCount(1)).toBe(1)
    const listBefore = await listMutations(1)
    expect(listBefore[0].id).toBe(clientRef)

    // Caregiver clicks Undo within 5s while offline:
    await removeMutation(clientRef)

    expect(await pendingMutationCount(1)).toBe(0)
    expect(await listMutations(1)).toHaveLength(0)
  })

  it('calls undoQuickLogAction endpoint when online', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 55,
          status: 'SKIPPED',
          outcome: 'REFUSED',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await undoQuickLogAction('test-token', 55)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/occurrences/55/undo/',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('caches and retrieves quick templates per user and patient', async () => {
    const templates: AdHocQuickTemplate[] = [
      {
        id: 1,
        title: 'Hydration / Drinking Water',
        category: 'HEALTH',
        icon: 'Droplets',
        is_quick_action: true,
        today_count: 3,
        active: true,
      },
    ]

    await cacheQuickTemplates(templates, 1, 7)
    const cached = await readCachedQuickTemplates(1, 7)
    expect(cached).toHaveLength(1)
    expect(cached[0].title).toBe('Hydration / Drinking Water')
    expect(cached[0].today_count).toBe(3)
  })

  it('omits schedule step and submits draft with is_quick_action when toggle is on', () => {
    const onCreateMock = vi.fn()
    const markup = renderToStaticMarkup(
      <TaskBuilder
        patient={patient}
        token="test-token"
        existingTitles={[]}
        onClose={vi.fn()}
        onCreate={onCreateMock}
        locale="en"
        initialStep={0}
      />,
    )
    expect(markup).toContain('Save as Pinned Quick Action on Today Dashboard')
  })
})
