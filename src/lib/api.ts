import { listMutations, queueMutation, removeMutation, updateMutation, type QueuedMutation } from './offline'
import type { DashboardResponse, Paginated, Patient, Session, TaskTemplate, VitalRecord } from './types'

const API_ROOT = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')
const SESSION_KEY = 'haven.session'

export class ApiError extends Error {
  status: number
  details: unknown

  constructor(message: string, status = 0, details?: unknown) {
    super(message)
    this.status = status
    this.details = details
  }
}

function errorMessage(details: unknown, fallback: string) {
  if (typeof details === 'object' && details !== null) {
    const record = details as Record<string, unknown>
    if (typeof record.detail === 'string') return record.detail
    const first = Object.values(record)[0]
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0]
    if (typeof first === 'string') return first
  }
  return fallback
}

export async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Token ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new ApiError('The care server is unreachable.', 0)
  }

  if (response.status === 204) return undefined as T
  const details = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(errorMessage(details, `Request failed (${response.status})`), response.status, details)
  }
  return details as T
}

export async function login(loginValue: string, password: string): Promise<Session> {
  return request<Session>('/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ login: loginValue, password }),
  })
}

export function saveSession(session: Session, persistent: boolean) {
  clearSession()
  const storage = persistent ? localStorage : sessionStorage
  storage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function loadSession(): Session | null {
  const value = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY)
  if (!value) return null
  try {
    return JSON.parse(value) as Session
  } catch {
    clearSession()
    return null
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(SESSION_KEY)
}

export async function logout(token: string) {
  return request<void>('/auth/logout/', { method: 'POST' }, token)
}

export async function getPrimaryDashboard(token: string): Promise<DashboardResponse> {
  const patients = await request<Paginated<Patient>>('/patients/', {}, token)
  if (!patients.results.length) throw new ApiError('No patient is assigned to this account.', 404)
  return request<DashboardResponse>(`/patients/${patients.results[0].id}/dashboard/`, {}, token)
}

export async function createTask(token: string, payload: Record<string, unknown>) {
  return request<TaskTemplate>('/tasks/', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export async function createVital(token: string, payload: Record<string, unknown>) {
  return request<VitalRecord>('/vitals/', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export type MutationResult<T> = { queued: boolean; data?: T }

export async function mutateOrQueue<T>(
  token: string,
  mutation: Omit<QueuedMutation, 'createdAt' | 'attempts'>,
): Promise<MutationResult<T>> {
  const item: QueuedMutation = { ...mutation, createdAt: new Date().toISOString(), attempts: 0 }
  if (!navigator.onLine) {
    await queueMutation(item)
    return { queued: true }
  }
  try {
    const data = await request<T>(item.path, { method: item.method, body: item.body ? JSON.stringify(item.body) : undefined }, token)
    return { queued: false, data }
  } catch (error) {
    if (error instanceof ApiError && error.status > 0 && error.status < 500) throw error
    await queueMutation(item)
    return { queued: true }
  }
}

export async function flushMutationQueue(token: string, userId: number) {
  const mutations = await listMutations(userId)
  let synced = 0
  for (const mutation of mutations) {
    try {
      await request(mutation.path, {
        method: mutation.method,
        body: mutation.body ? JSON.stringify(mutation.body) : undefined,
      }, token)
      await removeMutation(mutation.id)
      synced += 1
    } catch (error) {
      mutation.attempts += 1
      await updateMutation(mutation)
      if (error instanceof ApiError && error.status === 409) {
        await removeMutation(mutation.id)
        synced += 1
        continue
      }
      break
    }
  }
  return synced
}
