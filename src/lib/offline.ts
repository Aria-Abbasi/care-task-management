import type { DashboardResponse, Patient } from './types'

const DB_NAME = 'haven-care'
const DB_VERSION = 2
const MUTATIONS = 'mutations'
const CACHE = 'cache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MUTATION_REVIEW_MS = 7 * 24 * 60 * 60 * 1000

export type QueuedMutation = {
  id: string
  userId: number
  path: string
  method: 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  createdAt: string
  attempts: number
  status?: 'pending' | 'conflict' | 'failed'
  lastError?: string
  serverState?: unknown
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(MUTATIONS)) {
        database.createObjectStore(MUTATIONS, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(CACHE)) {
        database.createObjectStore(CACHE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function queueMutation(mutation: QueuedMutation) {
  const database = await openDatabase()
  const transaction = database.transaction(MUTATIONS, 'readwrite')
  await requestResult(transaction.objectStore(MUTATIONS).put(mutation))
  database.close()
}

export async function listMutations(userId?: number): Promise<QueuedMutation[]> {
  const database = await openDatabase()
  const transaction = database.transaction(MUTATIONS, 'readonly')
  const mutations = await requestResult(transaction.objectStore(MUTATIONS).getAll())
  database.close()
  const now = Date.now()
  const reviewed = mutations.map((mutation) => {
    if (now - new Date(mutation.createdAt).getTime() > MUTATION_REVIEW_MS && mutation.status === 'pending') {
      return { ...mutation, status: 'failed' as const, lastError: 'This offline record is more than seven days old and requires manual review.' }
    }
    return mutation
  })
  await Promise.all(reviewed.filter((item, index) => item !== mutations[index]).map(updateMutation))
  return reviewed
    .filter((mutation) => userId === undefined || mutation.userId === userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function removeMutation(id: string) {
  const database = await openDatabase()
  const transaction = database.transaction(MUTATIONS, 'readwrite')
  await requestResult(transaction.objectStore(MUTATIONS).delete(id))
  database.close()
}

export async function updateMutation(mutation: QueuedMutation) {
  await queueMutation(mutation)
}

export async function pendingMutationCount(userId?: number) {
  return (await listMutations(userId)).length
}

export async function queuedMutationOwners() {
  return [...new Set((await listMutations()).map((mutation) => mutation.userId))]
}

export async function clearOfflineData() {
  const database = await openDatabase()
  const transaction = database.transaction([MUTATIONS, CACHE], 'readwrite')
  transaction.objectStore(MUTATIONS).clear()
  transaction.objectStore(CACHE).clear()
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

export async function cacheDashboard(dashboard: DashboardResponse, userId: number) {
  const database = await openDatabase()
  const transaction = database.transaction(CACHE, 'readwrite')
  await requestResult(transaction.objectStore(CACHE).put({ userId, patientId: dashboard.patient.id, cachedAt: new Date().toISOString(), dashboard }, `dashboard:${userId}:${dashboard.patient.id}`))
  database.close()
}

export async function cachePatients(patients: Patient[], userId: number) {
  const database = await openDatabase()
  const transaction = database.transaction(CACHE, 'readwrite')
  await requestResult(transaction.objectStore(CACHE).put({ userId, cachedAt: new Date().toISOString(), patients }, `patients:${userId}`))
  database.close()
}

export async function readCachedPatients(userId: number): Promise<Patient[]> {
  const database = await openDatabase()
  const transaction = database.transaction(CACHE, 'readonly')
  const cached = await requestResult(transaction.objectStore(CACHE).get(`patients:${userId}`))
  database.close()
  if (!cached || typeof cached !== 'object') return []
  const record = cached as { userId?: number; cachedAt?: string; patients?: Patient[] }
  if (!record.cachedAt || Date.now() - new Date(record.cachedAt).getTime() > CACHE_TTL_MS) return []
  return record.userId === userId
    ? (cached as { patients?: Patient[] }).patients || []
    : []
}

export async function readCachedDashboard(userId: number, patientId?: number): Promise<DashboardResponse | null> {
  const database = await openDatabase()
  const transaction = database.transaction(CACHE, 'readonly')
  const store = transaction.objectStore(CACHE)
  const cached = patientId
    ? await requestResult(store.get(`dashboard:${userId}:${patientId}`))
    : (await requestResult(store.getAll())).find((value) => value && typeof value === 'object' && (value as { userId?: number }).userId === userId)
  database.close()
  if (!cached || typeof cached !== 'object') return null
  const value = cached as { userId?: number; cachedAt?: string; dashboard?: DashboardResponse }
  if (!value.cachedAt || Date.now() - new Date(value.cachedAt).getTime() > CACHE_TTL_MS) return null
  return value.userId === userId ? value.dashboard ?? null : null
}

export async function retryMutation(id: string) {
  const mutations = await listMutations()
  const mutation = mutations.find((item) => item.id === id)
  if (!mutation) return
  const details = mutation.serverState as { current?: { version?: number } } | undefined
  if (details?.current?.version && mutation.body && typeof mutation.body === 'object') {
    mutation.body = { ...(mutation.body as Record<string, unknown>), expected_version: details.current.version }
  }
  mutation.status = 'pending'
  mutation.lastError = undefined
  mutation.serverState = undefined
  await updateMutation(mutation)
}
