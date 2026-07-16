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
}

export type Session = {
  token: string
  user: ApiUser
}

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
  frequency: 'ONCE' | 'DAILY' | 'WEEKLY' | 'INTERVAL' | 'AFTER_EVENT'
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

export type TaskTemplate = {
  id: number
  patient: number
  patient_name: string
  title: string
  category: 'MEDICATION' | 'HEALTH' | 'MEAL' | 'ACTIVITY' | 'PERSONAL_CARE' | 'OTHER'
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  instructions: string
  assigned_to: number | null
  assigned_to_name: string | null
  active: boolean
  schedules: TaskSchedule[]
}

export type TaskOccurrence = {
  id: number
  task: number
  task_detail: TaskTemplate
  schedule: number | null
  scheduled_at: string
  effective_scheduled_at: string
  status: 'PENDING' | 'DONE' | 'MISSED' | 'SKIPPED' | 'DELAYED'
  completed_at: string | null
  completed_by: number | null
  delayed_until: string | null
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
  schedules: { id: number; time: string; days_of_week: number[]; instructions: string }[]
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
}

export type DashboardResponse = {
  date: string
  patient: Patient
  task_summary: { total: number; done: number; overdue: number; pending: number }
  occurrences: TaskOccurrence[]
  latest_vitals: VitalRecord[]
  medications: Medication[]
}

export type Paginated<T> = {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

