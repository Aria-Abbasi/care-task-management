/* Generated contract facade from docs/openapi.yaml. Regenerate when the API schema changes. */
export type ApiPath =
  | '/auth/login/' | '/auth/rotate/' | '/auth/password-reset/' | '/patients/'
  | `/patients/${number}/dashboard/` | `/occurrences/${number}/complete/`
  | `/occurrences/${number}/correct/` | `/dose-logs/${number}/administer/`
  | '/notifications/' | '/notification-preferences/' | '/push-subscriptions/'
  | '/conversations/' | '/messages/' | '/shift-assignments/'
  | '/audit-events/signed_export/' | '/fhir/metadata/' | `/fhir/${string}/`

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
