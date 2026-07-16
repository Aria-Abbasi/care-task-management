import type { DashboardResponse } from './types'

const DB_NAME = 'haven-care'
const DB_VERSION = 1
const MUTATIONS = 'mutations'
const CACHE = 'cache'

export type QueuedMutation = {
  id: string
  userId: number
  path: string
  method: 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  createdAt: string
  attempts: number
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
  return mutations
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
  await requestResult(transaction.objectStore(CACHE).put({ userId, dashboard }, 'dashboard'))
  database.close()
}

export async function readCachedDashboard(userId: number): Promise<DashboardResponse | null> {
  const database = await openDatabase()
  const transaction = database.transaction(CACHE, 'readonly')
  const cached = await requestResult(transaction.objectStore(CACHE).get('dashboard'))
  database.close()
  if (!cached || typeof cached !== 'object') return null
  const value = cached as { userId?: number; dashboard?: DashboardResponse }
  return value.userId === userId ? value.dashboard ?? null : null
}
