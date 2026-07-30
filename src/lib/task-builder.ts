import type { TaskSchedule } from './types'

export type TaskCategory = 'MEDICATION' | 'HEALTH' | 'MEAL' | 'ACTIVITY' | 'PERSONAL_CARE' | 'OTHER'
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type BuilderFrequency = TaskSchedule['frequency']

export type TaskCreationDraft = {
  title: string
  category: TaskCategory
  priority: TaskPriority
  assigned_to: number | null
  instructions: string
  expected_outcome: string
  safety_notes: string
  equipment: string[]
  requires_note: boolean
  requires_photo: boolean
  schedule: {
    frequency: BuilderFrequency
    time: string
    specific_date: string | null
    interval_hours: number | null
    days_of_week: number[]
    event_reference: string
    window_before_minutes: number
    window_after_minutes: number
    starts_on: string | null
    ends_on: string | null
  }
}

export const weekdays = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
] as const

export const todayValue = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function scheduleSummary(schedule: TaskCreationDraft['schedule'], locale = 'en') {
  const fa = locale === 'fa'
  const localTime = (value: string) => {
    if (!value) return fa ? 'زمان منعطف' : 'flexible time'
    if (!fa) return value
    const [hours, minutes] = value.split(':').map(Number)
    const number = new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2, useGrouping: false })
    return `${number.format(hours)}:${number.format(minutes)}`
  }
  const localDate = (value: string | null) => value && fa
    ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${value}T12:00:00`))
    : value
  const time = localTime(schedule.time)
  let recurrence = fa ? `هر روز ساعت ${time}` : `Every day at ${time}`
  if (schedule.frequency === 'ONCE') recurrence = fa ? `${localDate(schedule.specific_date) || 'تاریخ انتخاب‌شده'} ساعت ${time}` : `${schedule.specific_date || 'Selected date'} at ${time}`
  if (schedule.frequency === 'WEEKLY') {
    const persianWeekdays: Record<number, string> = { 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنجشنبه', 5: 'جمعه', 6: 'شنبه', 7: 'یکشنبه' }
    const labels = weekdays.filter(([value]) => schedule.days_of_week.includes(value)).map(([value, label]) => fa ? persianWeekdays[value] : label)
    recurrence = fa ? `${labels.join('، ') || 'روزهای انتخاب‌شده'} ساعت ${time}` : `${labels.join(', ') || 'Selected weekdays'} at ${time}`
  }
  if (schedule.frequency === 'INTERVAL') recurrence = fa ? `هر ${schedule.interval_hours || '؟'} ساعت از ${time}` : `Every ${schedule.interval_hours || '?'} hours from ${time}`
  const bounds = [schedule.starts_on ? (fa ? `از ${localDate(schedule.starts_on)}` : `from ${schedule.starts_on}`) : '', schedule.ends_on ? (fa ? `تا ${localDate(schedule.ends_on)}` : `until ${schedule.ends_on}`) : '']
    .filter(Boolean)
    .join(' ')
  return fa
    ? `${recurrence}${bounds ? `، ${bounds}` : ''} · بازه مجاز: ${schedule.window_before_minutes} دقیقه پیش از زمان / ${schedule.window_after_minutes} دقیقه پس از زمان`
    : `${recurrence}${bounds ? `, ${bounds}` : ''} · window ${schedule.window_before_minutes} min before / ${schedule.window_after_minutes} min after`
}

export function previewOccurrences(schedule: TaskCreationDraft['schedule'], count = 5) {
  const startValue = schedule.frequency === 'ONCE' ? schedule.specific_date : schedule.starts_on || todayValue()
  if (!startValue) return []
  const end = schedule.ends_on ? parseLocalDate(schedule.ends_on) : null
  const [hour, minute] = schedule.time.split(':').map(Number)
  const results: Date[] = []
  const cursor = parseLocalDate(startValue)
  cursor.setHours(hour || 0, minute || 0, 0, 0)
  const maximumDays = 370

  for (let day = 0; day < maximumDays && results.length < count; day += 1) {
    const currentDay = new Date(cursor)
    currentDay.setDate(cursor.getDate() + day)
    if (end && currentDay > new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59)) break
    if (schedule.frequency === 'ONCE') {
      results.push(currentDay)
      break
    }
    if (schedule.frequency === 'WEEKLY') {
      const isoDay = currentDay.getDay() || 7
      if (schedule.days_of_week.includes(isoDay)) results.push(currentDay)
      continue
    }
    if (schedule.frequency === 'INTERVAL') {
      const hours = schedule.interval_hours || 24
      const intervalCursor = new Date(currentDay)
      while (intervalCursor.getDate() === currentDay.getDate() && results.length < count) {
        results.push(new Date(intervalCursor))
        intervalCursor.setHours(intervalCursor.getHours() + hours)
      }
      continue
    }
    results.push(currentDay)
  }
  return results
}
