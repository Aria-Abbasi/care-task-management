import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { flushMutationQueue } from './api'
import {
  cacheDashboard,
  cacheQuickTemplates,
  clearOfflineData,
  listMutations,
  pendingMutationCount,
  queueMutation,
  readCachedDashboard,
  readCachedQuickTemplates,
  removeMutation,
  retryMutation,
} from './offline'
import type { AdHocQuickTemplate, DashboardResponse } from './types'


afterEach(async () => {
  vi.unstubAllGlobals()
  await clearOfflineData()
})

describe('offline care queue', () => {
  it('stores mutations in creation order', async () => {
    await queueMutation({ id: 'later', userId: 1, path: '/vitals/', method: 'POST', createdAt: '2026-07-16T10:01:00Z', attempts: 0 })
    await queueMutation({ id: 'earlier', userId: 1, path: '/occurrences/1/complete/', method: 'POST', createdAt: '2026-07-16T10:00:00Z', attempts: 0 })

    expect((await listMutations()).map((item) => item.id)).toEqual(['earlier', 'later'])
    expect(await pendingMutationCount()).toBe(2)
  })

  it('keeps each caregiver queue isolated', async () => {
    await queueMutation({ id: 'user-one', userId: 1, path: '/vitals/', method: 'POST', createdAt: '2026-07-16T10:00:00Z', attempts: 0 })
    await queueMutation({ id: 'user-two', userId: 2, path: '/vitals/', method: 'POST', createdAt: '2026-07-16T10:01:00Z', attempts: 0 })

    expect((await listMutations(1)).map((item) => item.id)).toEqual(['user-one'])
    expect((await listMutations(2)).map((item) => item.id)).toEqual(['user-two'])
  })

  it('replays and removes successful mutations', async () => {
    await queueMutation({
      id: 'completion-reference',
      userId: 1,
      path: '/occurrences/1/complete/',
      method: 'POST',
      body: { client_reference: 'completion-reference' },
      createdAt: '2026-07-16T10:00:00Z',
      attempts: 0,
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await flushMutationQueue('test-token', 1)).toEqual({ synced: 1, conflicts: 0, failed: 0 })
    expect(await pendingMutationCount()).toBe(0)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/occurrences/1/complete/',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('keeps the latest dashboard available offline', async () => {
    const dashboard = {
      date: '2026-07-16',
      patient: {
        id: 1,
        first_name: 'Hassan',
        last_name: 'Abbasi',
        full_name: 'Hassan Abbasi',
        birth_date: '1944-03-12',
        age: 82,
        gender: 'MALE',
        room: '204',
        medical_notes: '',
        photo: null,
        active: true,
      },
      occurrences: [],
      latest_vitals: [],
      medications: [],
      dose_logs: [],
      task_summary: { total: 0, done: 0, overdue: 0, pending: 0 },
    } satisfies DashboardResponse

    await cacheDashboard(dashboard, 1)
    expect((await readCachedDashboard(1))?.patient.full_name).toBe('Hassan Abbasi')
    expect(await readCachedDashboard(2)).toBeNull()
  })

  it('keeps a mutation queued when the server is unavailable', async () => {
    await queueMutation({
      id: 'unsynced-vital',
      userId: 1,
      path: '/vitals/',
      method: 'POST',
      createdAt: '2026-07-16T10:00:00Z',
      attempts: 0,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"detail":"Unavailable"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })))

    expect(await flushMutationQueue('test-token', 1)).toEqual({ synced: 0, conflicts: 0, failed: 0 })
    expect(await pendingMutationCount()).toBe(1)
    expect((await listMutations())[0].attempts).toBe(1)
  })

  it('keeps version conflicts for caregiver review and can retry with the server version', async () => {
    await queueMutation({
      id: 'conflicted-completion',
      userId: 1,
      path: '/occurrences/1/complete/',
      method: 'POST',
      body: { outcome: 'COMPLETED', expected_version: 1 },
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      detail: 'This care record changed on another device.',
      code: 'version_conflict',
      current: { version: 2, status: 'DONE' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })))

    expect(await flushMutationQueue('test-token', 1)).toEqual({ synced: 0, conflicts: 1, failed: 0 })
    expect((await listMutations(1))[0].status).toBe('conflict')
    await retryMutation('conflicted-completion')
    const retried = (await listMutations(1))[0]
    expect(retried.status).toBe('pending')
    expect(retried.body).toMatchObject({ expected_version: 2 })
  })

  it('caches and retrieves quick templates per user and patient', async () => {
    const sampleTemplates: AdHocQuickTemplate[] = [
      {
        id: 1,
        title: 'Hydration / Drinking Water',
        category: 'HEALTH',
        icon: 'Droplets',
        is_quick_action: true,
        today_count: 2,
        active: true,
      },
      {
        id: 2,
        title: 'Assisted Walk',
        category: 'ACTIVITY',
        icon: 'Footprints',
        is_quick_action: true,
        today_count: 0,
        active: true,
      },
    ]

    await cacheQuickTemplates(sampleTemplates, 1, 42)
    const cached = await readCachedQuickTemplates(1, 42)
    expect(cached).toHaveLength(2)
    expect(cached[0].title).toBe('Hydration / Drinking Water')

    // Isolation by user or patient
    const otherUser = await readCachedQuickTemplates(2, 42)
    expect(otherUser).toHaveLength(0)
    const otherPatient = await readCachedQuickTemplates(1, 99)
    expect(otherPatient).toHaveLength(0)
  })

  it('cancels offline quick actions by removing mutation from queue on undo', async () => {
    const clientRef = 'offline-action-uuid-1'
    await queueMutation({
      id: clientRef,
      userId: 1,
      path: '/ad-hoc-templates/1/log/',
      method: 'POST',
      body: { patient_id: 42, note: 'Hydration', client_reference: clientRef },
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
    })

    expect(await pendingMutationCount(1)).toBe(1)
    // Offline undo: remove directly from the queue
    await removeMutation(clientRef)
    expect(await pendingMutationCount(1)).toBe(0)
  })
})
