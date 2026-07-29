/* Generated contract facade from docs/openapi.yaml. Regenerate when the API schema changes. */
export type ApiPath =
  | '/auth/login/' | '/auth/logout/' | '/auth/rotate/' | '/auth/password-reset/' | '/auth/password-reset/confirm/' | '/auth/change-password/' | '/patients/'
  | '/assignments/' | '/tasks/' | '/task-templates/' | '/vitals/' | '/medications/' | '/refill-requests/' | '/stock-adjustments/'
  | `/patients/${number}/dashboard/` | `/occurrences/${number}/complete/`
  | `/occurrences/${number}/correct/` | `/occurrences/${number}/delay/` | `/occurrences/${number}/skip/` | `/dose-logs/${number}/administer/`
  | '/notifications/' | '/notification-preferences/' | '/push-subscriptions/'
  | '/conversations/' | '/messages/' | '/shift-assignments/'
  | '/audit-events/signed_export/' | '/fhir/metadata/' | `/fhir/${string}/`
  | (string & {})

export type LoginRequest = { login: string; password: string; mfa_code?: string; device_name?: string }
export type LoginResponse = { token: string; expires_at: string; user: { id: number; display_name: string; role: string } }
export type VersionedOutcome = { expected_version: number; client_reference?: string; note?: string }
export type FiveRightAdministration = VersionedOutcome & {
  verified_patient: true; verified_medication: true; verified_dose: true; verified_route: true; verified_time: true
}

export function createContractClient(baseUrl: string, token?: string) {
  return async function call<T>(path: ApiPath, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}), ...init.headers },
    })
    if (!response.ok) throw new Error(`Haven API returned ${response.status}`)
    return response.status === 204 ? undefined as T : response.json() as Promise<T>
  }
}

export function createContractTransport(baseUrl: string) {
  return (path: ApiPath, init: RequestInit = {}, token?: string) => fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...init.headers,
    },
  })
}
