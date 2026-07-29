export type ApiUser = {
  id: number
  username: string
  email: string
  phone: string | null
  first_name: string
  last_name: string
  display_name: string
  role: 'ADMIN' | 'CAREGIVER' | 'DOCTOR' | 'FAMILY'
  is_active: boolean
  organization: number | null
  organization_name: string
  mfa_enabled: boolean
}

export type Session = {
  token: string
  session_id: number
  expires_at: string
  user: ApiUser
}

export type Organization = { id: number; name: string; slug: string; country_code: string; timezone: string; active: boolean }

export type Patient = {
  id: number
  first_name: string
  last_name: string
  full_name: string
  birth_date: string
  age: number
  gender: string
  room: string
  medical_notes: string
  photo: string | null
  active: boolean
}

export type TaskSchedule = {
  id: number
  frequency: 'ONCE' | 'DAILY' | 'WEEKLY' | 'INTERVAL'
  time: string | null
  specific_date: string | null
  interval_hours: number | null
  days_of_week: number[]
  event_reference: string
  window_before_minutes: number
  window_after_minutes: number
  starts_on: string | null
  ends_on: string | null
}

export type CareAssignment = {
  id: number
  user: number
  user_detail: ApiUser
  patient: number
  patient_name: string
  relationship: 'PRIMARY_CAREGIVER' | 'CAREGIVER' | 'DOCTOR' | 'FAMILY' | 'ADMINISTRATOR'
  active: boolean
  starts_at: string | null
  ends_at: string | null
}

export type TaskTemplate = {
  id: number
  patient: number
  patient_name: string
  title: string
  category: 'MEDICATION' | 'HEALTH' | 'MEAL' | 'ACTIVITY' | 'PERSONAL_CARE' | 'OTHER'
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  instructions: string
  expected_outcome: string
  safety_notes: string
  equipment: string[]
  requires_note: boolean
  requires_photo: boolean
  assigned_to: number | null
  assigned_to_name: string | null
  active: boolean
  schedules: TaskSchedule[]
}

export type OrganizationTaskTemplate = {
  id: number
  name: string
  title: string
  category: TaskTemplate['category']
  priority: TaskTemplate['priority']
  instructions: string
  expected_outcome: string
  safety_notes: string
  equipment: string[]
  schedule_defaults: Partial<TaskSchedule>
  active: boolean
}

export type PushSubscription = { id: number; endpoint: string; device_name: string; active: boolean; created_at: string }

export type TaskOccurrence = {
  id: number
  task: number
  task_detail: TaskTemplate
  schedule: number | null
  scheduled_at: string
  effective_scheduled_at: string
  status: 'PENDING' | 'DONE' | 'MISSED' | 'SKIPPED' | 'DELAYED'
  outcome: '' | 'COMPLETED' | 'PARTIAL' | 'UNABLE' | 'REFUSED'
  version: number
  completed_at: string | null
  completed_by: number | null
  delayed_until: string | null
  completion: null | {
    id: number
    completed_by_name: string
    outcome: 'COMPLETED' | 'PARTIAL' | 'UNABLE' | 'REFUSED'
    note: string
    photo: string | null
    created_at: string
  }
  corrections: TaskCorrection[]
  updated_at: string
}

export type TaskCorrection = {
  id: number
  previous_status: TaskOccurrence['status']
  corrected_status: TaskOccurrence['status']
  previous_outcome: string
  corrected_outcome: string
  reason: string
  note: string
  corrected_by_name: string
  created_at: string
}

export type Medication = {
  id: number
  patient: number
  patient_name: string
  name: string
  dose: string
  unit: string
  route: string
  instructions: string
  photo: string | null
  stock_quantity: number | null
  active: boolean
  barcode: string
  is_prn: boolean
  prn_reason: string
  max_daily_doses: number | null
  timing_window_minutes: number
  timing_escalation_level: number
  timing_escalation_policy: number | null
  starts_on: string | null
  ends_on: string | null
  approval_status: 'PENDING' | 'APPROVED' | 'REJECTED'
  warnings: { severity: string; message: string; source: string }[]
  schedules: { id: number; time: string; days_of_week: number[]; instructions: string }[]
}
export type RefillRequest = { id: number; medication: number; medication_name: string; requested_by_name: string; quantity: number; status: 'REQUESTED' | 'ORDERED' | 'RECEIVED' | 'CANCELED'; note: string; resolved_at: string | null; created_at: string }

export type DoseLog = {
  id: number
  medication: number
  medication_name: string
  patient: number
  patient_name: string
  dose: string
  unit: string
  route: string
  scheduled_at: string
  status: 'SCHEDULED' | 'GIVEN' | 'MISSED' | 'REFUSED' | 'HELD'
  version: number
  administered_at: string | null
  administered_by_name: string | null
  note: string
  verified_patient: boolean
  verified_medication: boolean
  verified_dose: boolean
  verified_route: boolean
  verified_time: boolean
  was_late: boolean
  late_minutes: number
  timing_status: 'ON_TIME' | 'EARLY' | 'LATE'
  timing_variance_minutes: number
  timing_window_minutes: number
  timing_reason: string
  is_prn: boolean
  corrections: DoseCorrection[]
  updated_at: string
}

export type DoseCorrection = {
  id: number
  previous_status: DoseLog['status']
  corrected_status: DoseLog['status']
  reason: string
  note: string
  corrected_by_name: string
  created_at: string
}

export type VitalRecord = {
  id: number
  patient: number
  patient_name: string
  type: 'BLOOD_PRESSURE' | 'HEART_RATE' | 'OXYGEN' | 'TEMPERATURE' | 'WEIGHT' | 'GLUCOSE'
  value: string
  secondary_value: string | null
  unit: string
  recorded_at: string
  recorded_by: number | null
  recorded_by_name: string | null
  note: string
  source_system: string
  external_id: string
  provenance: Record<string, unknown>
}

export type DashboardResponse = {
  date: string
  patient: Patient
  task_summary: { total: number; done: number; overdue: number; pending: number }
  occurrences: TaskOccurrence[]
  latest_vitals: VitalRecord[]
  medications: Medication[]
  dose_logs: DoseLog[]
}

export type CareNotification = {
  id: number
  patient: number
  patient_name: string
  kind: 'TASK_OVERDUE' | 'DOSE_OVERDUE' | 'SYNC_CONFLICT' | 'VITAL_ALERT' | 'URGENT_MESSAGE'
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  state: 'UNREAD' | 'READ' | 'ACKNOWLEDGED' | 'SNOOZED'
  title: string
  message: string
  source_type: string
  source_id: string
  escalation_level: number
  due_at: string
  snoozed_until: string | null
  created_at: string
  delivery_status: Record<string, string>
}

export type NotificationPreference = {
  push_enabled: boolean
  sms_enabled: boolean
  voice_enabled: boolean
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  critical_override: boolean
  timezone: string
  updated_at: string
}

export type DeviceSession = {
  id: number
  device_name: string
  user_agent: string
  created_at: string
  last_used_at: string
  expires_at: string
  revoked_at: string | null
  active: boolean
}

export type Message = {
  id: number
  conversation: number
  sender: number
  sender_name: string
  body: string
  clinical: boolean
  urgent: boolean
  attachment: string
  voice_note: string
  created_at: string
  read_receipts: { user: number; user_name: string; read_at: string }[]
}

export type Conversation = {
  id: number
  patient: number
  patient_name: string
  title: string
  kind: 'CLINICAL' | 'FAMILY'
  participant_details: ApiUser[]
  latest_message: Message | null
  updated_at: string
}

export type ShiftReport = {
  id: number
  patient: number
  author_name: string
  recipient_name: string | null
  shift_started_at: string
  shift_ended_at: string
  observations: string
  concerns: string
  status: string
  acknowledged_by_name: string | null
  acknowledged_at: string | null
  created_at: string
}

export type ShiftAssignment = {
  id: number
  patient: number
  caregiver: number
  caregiver_name: string
  starts_at: string
  ends_at: string
  status: string
  notes: string
}

export type Allergy = { id: number; substance: string; reaction: string; severity: string; active: boolean; source_system: string }
export type Diagnosis = { id: number; display: string; code: string; status: string; diagnosed_at: string | null; notes: string; source_system: string }
export type CarePlan = { id: number; title: string; status: string; goals: string[]; instructions: string; author_name: string; starts_on: string | null; ends_on: string | null }
export type EmergencyContact = { id: number; name: string; relationship: string; phone: string; email: string; priority: number; authorized_for_updates: boolean }
export type AdvanceDirective = { id: number; directive_type: string; summary: string; effective_from: string | null; reviewed_at: string | null; active: boolean }
export type ClinicalDocument = { id: number; title: string; category: string; file: string; checksum_sha256: string; retention_until: string | null; source_system: string }
export type WoundRecord = { id: number; location: string; description: string; length_cm: string | null; width_cm: string | null; recorded_at: string }
export type VitalThreshold = { id: number; vital_type: VitalRecord['type']; minimum: string | null; maximum: string | null; secondary_minimum: string | null; secondary_maximum: string | null; severity: 'WARNING' | 'CRITICAL'; consecutive_readings: number; active: boolean }
export type EscalationPolicy = { id: number; name: string; active: boolean; is_default: boolean; steps: { id: number; level: number; delay_minutes: number; channel: 'IN_APP' | 'PUSH' | 'SMS' | 'VOICE'; recipient_roles: string[] }[] }
export type NotificationDelivery = { id: number; notification_title: string; channel: string; status: string; attempts: number; error: string; next_attempt_at: string | null; created_at: string }
export type CaregiverAvailability = { id: number; caregiver: number; caregiver_name: string; starts_at: string; ends_at: string; available: boolean; note: string }
export type CalendarData = { start: string; end: string; occurrences: TaskOccurrence[]; shifts: ShiftAssignment[]; availability: CaregiverAvailability[]; assignments: CareAssignment[] }

export type AuditEvent = {
  id: number
  actor_name: string | null
  patient: number
  patient_name: string
  action: string
  entity_type: string
  entity_id: string
  summary: string
  metadata: Record<string, unknown>
  created_at: string
}

export type Paginated<T> = {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}
