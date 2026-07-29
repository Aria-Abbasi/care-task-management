import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { flushMutationQueue } from './api'
import {
  cacheDashboard,
  clearOfflineData,
  listMutations,
  pendingMutationCount,
  queueMutation,
  readCachedDashboard,
  retryMutation,
} from './offline'
import type { DashboardResponse } from './types'


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
})
