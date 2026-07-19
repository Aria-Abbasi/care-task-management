import { listMutations, queueMutation, removeMutation, updateMutation, type QueuedMutation } from './offline'
import type { AdvanceDirective, Allergy, ApiUser, AuditEvent, CareNotification, CarePlan, CaregiverAvailability, ClinicalDocument, Conversation, DashboardResponse, DeviceSession, Diagnosis, EmergencyContact, EscalationPolicy, Message, NotificationDelivery, NotificationPreference, Paginated, Patient, Session, ShiftAssignment, ShiftReport, TaskTemplate, VitalRecord } from './types'

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
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
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

export async function downloadSecureFile(path: string, token: string) {
  const response = await fetch(`${API_ROOT}${path.replace(/^\/api\/v1/, '')}`, { headers: { Authorization: `Token ${token}` } })
  if (!response.ok) throw new ApiError('The secure file could not be opened.', response.status)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1] || 'haven-secure-file'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function login(loginValue: string, password: string, mfaCode = ''): Promise<Session> {
  return request<Session>('/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ login: loginValue, password, mfa_code: mfaCode, device_name: navigator.userAgent.slice(0, 80) }),
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
    const session = JSON.parse(value) as Session
    if (!session.session_id || !session.expires_at || new Date(session.expires_at) <= new Date()) {
      clearSession()
      return null
    }
    return session
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

export async function rotateSession(token: string) {
  return request<Session>('/auth/rotate/', { method: 'POST' }, token)
}

export async function getPrimaryDashboard(token: string): Promise<DashboardResponse> {
  const patients = await request<Paginated<Patient>>('/patients/', {}, token)
  if (!patients.results.length) throw new ApiError('No patient is assigned to this account.', 404)
  return request<DashboardResponse>(`/patients/${patients.results[0].id}/dashboard/`, {}, token)
}

export async function getPatients(token: string): Promise<Patient[]> {
  return (await request<Paginated<Patient>>('/patients/?ordering=first_name,last_name', {}, token)).results
}

export async function getPatientDashboard(token: string, patientId: number, date?: string): Promise<DashboardResponse> {
  return request<DashboardResponse>(`/patients/${patientId}/dashboard/${date ? `?date=${date}` : ''}`, {}, token)
}

export const getVitals = async (token: string, patientId: number) => (await request<Paginated<VitalRecord>>(`/vitals/?patient=${patientId}&ordering=recorded_at`, {}, token)).results
export const getConversations = async (token: string, patientId: number) => (await request<Paginated<Conversation>>(`/conversations/?patient=${patientId}`, {}, token)).results
export const getMessages = async (token: string, conversationId: number) => (await request<Paginated<Message>>(`/messages/?conversation=${conversationId}&ordering=created_at`, {}, token)).results
export async function sendMessage(token: string, conversation: number, body: string, urgent: boolean, clinical: boolean, attachment?: File | null, voiceNote?: Blob | null) {
  if (attachment || voiceNote) {
    const form = new FormData()
    form.append('conversation', String(conversation)); form.append('body', body); form.append('urgent', String(urgent)); form.append('clinical', String(clinical)); form.append('client_reference', crypto.randomUUID())
    if (attachment) form.append('attachment_upload', attachment)
    if (voiceNote) form.append('voice_note_upload', voiceNote, `voice-${Date.now()}.webm`)
    return request<Message>('/messages/', { method: 'POST', body: form }, token)
  }
  return request<Message>('/messages/', { method: 'POST', body: JSON.stringify({ conversation, body, urgent, clinical, client_reference: crypto.randomUUID() }) }, token)
}
export const markMessageRead = async (token: string, messageId: number) => request(`/messages/${messageId}/read/`, { method: 'POST' }, token)
export const getReports = async (token: string, patientId: number) => (await request<Paginated<ShiftReport>>(`/shift-reports/?patient=${patientId}&ordering=-created_at`, {}, token)).results
export const acknowledgeReport = async (token: string, id: number) => request<ShiftReport>(`/shift-reports/${id}/acknowledge/`, { method: 'POST' }, token)
export const getShifts = async (token: string, patientId: number) => (await request<Paginated<ShiftAssignment>>(`/shift-assignments/?patient=${patientId}&ordering=starts_at`, {}, token)).results
export async function getClinicalProfile(token: string, patientId: number) {
  const paths = ['allergies', 'diagnoses', 'care-plans', 'emergency-contacts', 'advance-directives', 'clinical-documents']
  const [allergies, diagnoses, carePlans, contacts, directives, documents] = await Promise.all(paths.map((path) => request<Paginated<unknown>>(`/${path}/?patient=${patientId}`, {}, token).then((result) => result.results)))
  return { allergies: allergies as Allergy[], diagnoses: diagnoses as Diagnosis[], carePlans: carePlans as CarePlan[], contacts: contacts as EmergencyContact[], directives: directives as AdvanceDirective[], documents: documents as ClinicalDocument[] }
}
export const lookupMedicationBarcode = async (token: string, code: string) => request<import('./types').Medication>(`/medications/barcode/?code=${encodeURIComponent(code)}`, {}, token)
export const requestRefill = async (token: string, medication: number, quantity: number, note: string) => request('/refill-requests/', { method: 'POST', body: JSON.stringify({ medication, quantity, note }) }, token)
export const administerPrn = async (token: string, medicationId: number, note: string) => request(`/medications/${medicationId}/prn-dose/`, { method: 'POST', body: JSON.stringify({ note, verified_patient: true, verified_medication: true, verified_dose: true, verified_route: true, verified_time: true }) }, token)
export const reviewMedicationOrder = async (token: string, medicationId: number, decision: 'approve' | 'reject', reason = '') => request(`/medications/${medicationId}/${decision}/`, { method: 'POST', body: JSON.stringify({ reason }) }, token)
export async function getAdminOverview(token: string) {
  const [users, policies, deliveries, availability] = await Promise.all([
    request<Paginated<ApiUser>>('/users/?ordering=first_name,last_name', {}, token),
    request<Paginated<EscalationPolicy>>('/escalation-policies/', {}, token),
    request<Paginated<NotificationDelivery>>('/notification-deliveries/?ordering=-created_at', {}, token),
    request<Paginated<CaregiverAvailability>>('/caregiver-availability/?ordering=starts_at', {}, token),
  ])
  return { users: users.results, policies: policies.results, deliveries: deliveries.results, availability: availability.results }
}
export const retryNotificationDelivery = async (token: string, id: number) => request(`/notification-deliveries/${id}/retry/`, { method: 'POST' }, token)
export const getNotificationPreference = async (token: string) => request<NotificationPreference>('/notification-preferences/', {}, token)
export const updateNotificationPreference = async (token: string, values: Partial<NotificationPreference>) => request<NotificationPreference>('/notification-preferences/me/', { method: 'PATCH', body: JSON.stringify(values) }, token)
export const getSessions = async (token: string) => (await request<Paginated<DeviceSession>>('/sessions/', {}, token)).results
export const revokeSession = async (token: string, id: number) => request<void>(`/sessions/${id}/revoke/`, { method: 'POST' }, token)
export const revokeOtherSessions = async (token: string) => request<{ revoked: number }>('/sessions/revoke_others/', { method: 'POST' }, token)
export const requestPasswordReset = async (loginValue: string) => request<{ detail: string }>('/auth/password-reset/', { method: 'POST', body: JSON.stringify({ login: loginValue }) })
export const confirmPasswordReset = async (uid: string, resetToken: string, newPassword: string) => request<void>('/auth/password-reset/confirm/', { method: 'POST', body: JSON.stringify({ uid, token: resetToken, new_password: newPassword }) })
export const setupMfa = async (token: string) => request<{ secret: string; otpauth_uri: string }>('/mfa/setup/', { method: 'POST' }, token)
export const confirmMfa = async (token: string, code: string) => request<{ enabled: boolean }>('/mfa/confirm/', { method: 'POST', body: JSON.stringify({ code }) }, token)

function base64UrlToBytes(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const decoded = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
}

export async function enableWebPush(token: string) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new ApiError('Background push is not supported by this browser.')
  const config = await request<{ public_key: string; configured: boolean }>('/push-subscriptions/config/', {}, token)
  if (!config.configured) throw new ApiError('Web Push has not been configured by your organization.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new ApiError('Notification permission was not granted.')
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(config.public_key) })
  const json = subscription.toJSON()
  return request('/push-subscriptions/', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, device_name: navigator.platform || 'Browser' }) }, token)
}

export async function refreshNotifications(token: string): Promise<CareNotification[]> {
  return request<CareNotification[]>('/notifications/refresh/', { method: 'POST' }, token)
}

export async function updateNotification(token: string, id: number, action: 'read' | 'acknowledge' | 'snooze', body?: Record<string, unknown>) {
  return request<CareNotification>(`/notifications/${id}/${action}/`, { method: 'POST', body: JSON.stringify(body || {}) }, token)
}

export async function getAuditEvents(token: string, patientId: number): Promise<AuditEvent[]> {
  return (await request<Paginated<AuditEvent>>(`/audit-events/?patient=${patientId}&ordering=-created_at`, {}, token)).results
}
export const getSignedAuditExport = async (token: string, patientId: number) => request<Record<string, unknown>>(`/audit-events/signed_export/?patient=${patientId}`, {}, token)

export async function createTask(token: string, payload: Record<string, unknown>) {
  return request<TaskTemplate>('/tasks/', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export async function createVital(token: string, payload: Record<string, unknown>) {
  return request<VitalRecord>('/vitals/', { method: 'POST', body: JSON.stringify(payload) }, token)
}

export type MutationResult<T> = { queued: boolean; data?: T; conflict?: boolean }

export async function mutateOrQueue<T>(
  token: string,
  mutation: Omit<QueuedMutation, 'createdAt' | 'attempts'>,
): Promise<MutationResult<T>> {
  const item: QueuedMutation = { ...mutation, createdAt: new Date().toISOString(), attempts: 0, status: 'pending' }
  if (!navigator.onLine) {
    await queueMutation(item)
    return { queued: true }
  }
  try {
    const data = await request<T>(item.path, { method: item.method, body: item.body ? JSON.stringify(item.body) : undefined }, token)
    return { queued: false, data }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      item.status = 'conflict'
      item.lastError = error.message
      item.serverState = error.details
      await queueMutation(item)
      return { queued: true, conflict: true }
    }
    if (error instanceof ApiError && error.status > 0 && error.status < 500) throw error
    await queueMutation(item)
    return { queued: true }
  }
}

export async function flushMutationQueue(token: string, userId: number) {
  const mutations = await listMutations(userId)
  let synced = 0
  let conflicts = 0
  let failed = 0
  for (const mutation of mutations) {
    if (mutation.status === 'conflict' || mutation.status === 'failed') continue
    try {
      await request(mutation.path, {
        method: mutation.method,
        body: mutation.body ? JSON.stringify(mutation.body) : undefined,
      }, token)
      await removeMutation(mutation.id)
      synced += 1
    } catch (error) {
      mutation.attempts += 1
      if (error instanceof ApiError && error.status === 409) {
        mutation.status = 'conflict'
        mutation.lastError = error.message
        mutation.serverState = error.details
        await updateMutation(mutation)
        conflicts += 1
        continue
      }
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        mutation.status = 'failed'
        mutation.lastError = error.message
        mutation.serverState = error.details
        await updateMutation(mutation)
        failed += 1
        continue
      }
      mutation.lastError = error instanceof Error ? error.message : 'The care server is unavailable.'
      await updateMutation(mutation)
      break
    }
  }
  return { synced, conflicts, failed }
}
