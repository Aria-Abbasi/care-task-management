import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadClinicalDocument, getCareAssignments } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('frontend API contracts', () => {
  it('loads assignees from the Django assignments route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 0, next: null, previous: null, results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await getCareAssignments('session', 7)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/assignments/?patient=7&active=true')
  })

  it('uses the audited clinical-document download action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(downloadClinicalDocument('session', 42)).rejects.toThrow()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/clinical-documents/42/download/')
  })
})
