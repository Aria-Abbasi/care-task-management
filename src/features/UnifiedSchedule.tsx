import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Droplets, HeartPulse, Plus, ShieldCheck, Sparkles, UserRound, X, Zap } from 'lucide-react'

import { createAdHocTask, getCalendar } from '../lib/api'
import { filterScheduleOccurrences, type ScheduleStatusFilter } from '../lib/schedule'
import type { CalendarData, Patient, Session, TaskOccurrence } from '../lib/types'

type Mode = 'day' | 'week' | 'month'
type Props = { session: Session; patient: Patient; selectedDate: string; locale: string; onDate: (date: string) => Promise<void>; onRecordOccurrence: (occurrence: TaskOccurrence) => void; onAdd: () => void }

const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const sameDay = (a: Date, b: Date) => key(a) === key(b)

function rangeFor(selected: Date, mode: Mode, rtl: boolean) {
  if (mode === 'day') { const end = new Date(selected); end.setDate(end.getDate() + 1); return [selected, end] as const }
  const start = new Date(selected)
  start.setDate(start.getDate() - ((start.getDay() - (rtl ? 6 : 1) + 7) % 7))
  const end = new Date(start); end.setDate(end.getDate() + (mode === 'week' ? 7 : 42))
  return [start, end] as const
}

function statusText(status: TaskOccurrence['status'], fa: boolean) {
  const faText: Record<TaskOccurrence['status'], string> = { PENDING: 'در انتظار', DONE: 'انجام‌شده', MISSED: 'سررسید گذشته', SKIPPED: 'رد شده', DELAYED: 'با تأخیر' }
  return fa ? faText[status] : status.replace('_', ' ').toLowerCase()
}

export default function UnifiedSchedule({ session, patient, selectedDate, locale, onDate, onRecordOccurrence, onAdd }: Props) {
  const fa = locale === 'fa'
  const [mode, setMode] = useState<Mode>('day')
  const [statusFilter, setStatusFilter] = useState<ScheduleStatusFilter>('all')
  const [data, setData] = useState<CalendarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<TaskOccurrence | null>(null)
  const [adHocOpen, setAdHocOpen] = useState(false)
  const [adHocTitle, setAdHocTitle] = useState('')
  const [adHocNote, setAdHocNote] = useState('')
  const [adHocSubmitting, setAdHocSubmitting] = useState(false)
  const base = useMemo(() => new Date(`${selectedDate}T12:00:00`), [selectedDate])
  const [start, end] = useMemo(() => rangeFor(base, mode, fa), [base, mode, fa])
  const startKey = key(start); const endKey = key(end)
  const localeCode = fa ? 'fa-IR-u-ca-persian' : 'en'
  const copy = fa ? {
    eyebrow: 'تقویم مراقبت', title: 'برنامه مراقبت', action: 'افزودن فعالیت', day: 'روز', week: 'هفته', month: 'ماه',
    loading: 'در حال بارگذاری تقویم مراقبت', retry: 'تلاش دوباره', noCare: 'برای این بازه فعالیتی برنامه‌ریزی نشده است',
    noCareDetail: 'یک وظیفه بسازید یا روز دیگری را انتخاب کنید.', noMatch: 'فعالیتی با این وضعیت پیدا نشد',
    noMatchDetail: 'فیلتر دیگری را انتخاب کنید یا به بازهٔ دیگری بروید.', coverage: 'پوشش شیفت', availability: 'دسترسی مراقب',
    today: 'امروز', record: 'ثبت نتیجه ایمن', details: 'جزئیات فعالیت', assigned: 'مسئول', schedule: 'زمان‌بندی‌شده',
    safety: 'راهنمای ایمنی', close: 'بستن جزئیات', count: 'فعالیت', filter: 'فیلتر وضعیت وظایف', all: 'همه',
    completed: 'انجام‌شده', pending: 'در انتظار', overdue: 'سررسید گذشته', results: 'فعالیت نمایش داده می‌شود',
    quickActions: 'ثبت سریع و موردی', logHydration: 'آب‌رسانی (۲۰۰ میلی‌لیتر)', logTurn: 'تغییر وضعیت بیمار',
    logBathroom: 'کمک به سرویس بهداشتی', adHocCare: 'ثبت کار مراقبتی موردی',
  } : {
    eyebrow: 'CARE CALENDAR', title: 'Care schedule', action: 'Add task', day: 'Day', week: 'Week', month: 'Month',
    loading: 'Loading care calendar', retry: 'Try again', noCare: 'No care is scheduled for this period',
    noCareDetail: 'Create a task or choose another day.', noMatch: 'No activities match this status',
    noMatchDetail: 'Choose another filter or move to a different period.', coverage: 'Shift coverage',
    availability: 'Caregiver availability', today: 'Today', record: 'Record safe outcome', details: 'Activity details',
    assigned: 'Assigned to', schedule: 'Scheduled', safety: 'Safety guidance', close: 'Close details',
    count: 'care activities', filter: 'Filter tasks by status', all: 'All', completed: 'Completed', pending: 'Pending',
    overdue: 'Overdue', results: 'activities shown', quickActions: 'Quick on-demand log',
    logHydration: 'Hydration (200ml)', logTurn: 'Position repositioning', logBathroom: 'Bathroom assistance',
    adHocCare: 'Log ad-hoc task',
  }

  const load = () => {
    setLoading(true); setError('')
    getCalendar(session.token, patient.id, startKey, endKey).then(setData).catch(() => setError(fa ? 'بارگذاری تقویم ممکن نشد. دوباره تلاش کنید.' : 'The calendar could not be loaded. Try again.')).finally(() => setLoading(false))
  }
  useEffect(load, [session.token, patient.id, startKey, endKey, fa])
  const allOccurrences = useMemo(() => data?.occurrences || [], [data])
  const filteredOccurrences = useMemo(() => filterScheduleOccurrences(allOccurrences, statusFilter), [allOccurrences, statusFilter])
  const filterCounts: Record<ScheduleStatusFilter, number> = {
    all: allOccurrences.length,
    completed: filterScheduleOccurrences(allOccurrences, 'completed').length,
    pending: filterScheduleOccurrences(allOccurrences, 'pending').length,
    overdue: filterScheduleOccurrences(allOccurrences, 'overdue').length,
  }
  const occurrenceFor = (date: Date) => filteredOccurrences.filter((item) => sameDay(new Date(item.effective_scheduled_at), date))
  const goDay = async (date: Date) => { await onDate(key(date)); setMode('day') }
  const dateLabel = new Intl.DateTimeFormat(localeCode, { dateStyle: 'full' }).format(base)
  const navigationLabel = useMemo(() => {
    if (mode === 'day') return dateLabel
    if (mode === 'month') return new Intl.DateTimeFormat(localeCode, { month: 'long', year: 'numeric' }).format(base)
    const weekEnd = new Date(start); weekEnd.setDate(weekEnd.getDate() + 6)
    const format = new Intl.DateTimeFormat(localeCode, { month: 'short', day: 'numeric' })
    return `${format.format(start)} – ${format.format(weekEnd)}`
  }, [base, dateLabel, localeCode, mode, start])

  const movePeriod = async (direction: -1 | 1) => {
    const next = new Date(base)
    if (mode === 'day') next.setDate(next.getDate() + direction)
    if (mode === 'week') next.setDate(next.getDate() + direction * 7)
    if (mode === 'month') next.setMonth(next.getMonth() + direction)
    await onDate(key(next))
  }

  const handleQuickLog = async (title: string, category: string, defaultNote: string) => {
    try {
      await createAdHocTask(session.token, {
        patient: patient.id,
        title,
        category,
        note: defaultNote,
        outcome: 'COMPLETED',
      })
      load()
    } catch {
      // ignore
    }
  }

  const submitAdHoc = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adHocTitle.trim()) return
    setAdHocSubmitting(true)
    try {
      await createAdHocTask(session.token, {
        patient: patient.id,
        title: adHocTitle,
        note: adHocNote,
        outcome: 'COMPLETED',
      })
      setAdHocTitle('')
      setAdHocNote('')
      setAdHocOpen(false)
      load()
    } finally {
      setAdHocSubmitting(false)
    }
  }

  const canLogAdHoc = session.user.role !== 'FAMILY' || session.user.allow_family_task_completion

  return <>
    <section className="page-header schedule-primary-header">
      <div>
        <span className="eyebrow">{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{dateLabel}</p>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {canLogAdHoc && (
          <button className="secondary-button" onClick={() => setAdHocOpen(true)}>
            <Zap size={16} /> {copy.adHocCare}
          </button>
        )}
        <button className="primary-button" onClick={onAdd}>
          <CalendarDays />{copy.action}
        </button>
      </div>
    </section>

    {canLogAdHoc && (
      <section className="quick-actions-bar" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.75rem 0', padding: '0.5rem 0.75rem', background: 'var(--surface-subtle, rgba(241, 245, 249, 0.6))', borderRadius: '0.75rem' }}>
        <small style={{ color: 'var(--muted, #64748b)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <Sparkles size={14} /> {copy.quickActions}:
        </small>
        <button
          className="secondary-button compact-chip"
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', borderRadius: '1rem', border: '1px solid var(--border, #cbd5e1)' }}
          onClick={() => handleQuickLog(fa ? 'آب‌رسانی' : 'Hydration Assistance', 'PERSONAL_CARE', fa ? 'نوشیدن ۲۰۰ میلی‌لیتر آب' : 'Drank 200ml water')}
        >
          <Droplets size={13} style={{ color: '#0284c7' }} /> {copy.logHydration}
        </button>
        <button
          className="secondary-button compact-chip"
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', borderRadius: '1rem', border: '1px solid var(--border, #cbd5e1)' }}
          onClick={() => handleQuickLog(fa ? 'تغییر وضعیت بیمار' : 'Position Repositioning', 'PERSONAL_CARE', fa ? 'تغییر حالت به پهلوی راست' : 'Repositioned to right lateral')}
        >
          <HeartPulse size={13} style={{ color: '#10b981' }} /> {copy.logTurn}
        </button>
        <button
          className="secondary-button compact-chip"
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem', borderRadius: '1rem', border: '1px solid var(--border, #cbd5e1)' }}
          onClick={() => handleQuickLog(fa ? 'کمک به سرویس بهداشتی' : 'Bathroom Assistance', 'PERSONAL_CARE', fa ? 'همراهی ایمن و شست‌وشو' : 'Assisted safely to restroom')}
        >
          <UserRound size={13} style={{ color: '#8b5cf6' }} /> {copy.logBathroom}
        </button>
      </section>
    )}

    <section className="unified-calendar" aria-label={copy.title}>
      <header className="unified-calendar-toolbar">
        <div className="calendar-navigation" role="group" aria-label={fa ? 'پیمایش تقویم' : 'Calendar navigation'}>
          <button type="button" onClick={() => movePeriod(-1)} aria-label={fa ? `${mode === 'day' ? 'روز' : mode === 'week' ? 'هفته' : 'ماه'} قبل` : `Previous ${mode}`}><ChevronLeft /></button>
          <strong aria-live="polite">{navigationLabel}</strong>
          <button type="button" onClick={() => movePeriod(1)} aria-label={fa ? `${mode === 'day' ? 'روز' : mode === 'week' ? 'هفته' : 'ماه'} بعد` : `Next ${mode}`}><ChevronRight /></button>
        </div>
        <div className="schedule-toolbar-actions">
          <div className="schedule-view-controls" role="group" aria-label={fa ? 'نمای تقویم' : 'Calendar view'}>
            {(['day', 'week', 'month'] as Mode[]).map((item) => <button key={item} className={mode === item ? 'active' : ''} aria-pressed={mode === item} onClick={() => setMode(item)}>{copy[item]}</button>)}
          </div>
          <button className="calendar-today-button" onClick={() => onDate(key(new Date()))}>{copy.today}</button>
        </div>
      </header>
      <div className="schedule-status-filter" role="group" aria-label={copy.filter}>
        {(['all', 'completed', 'pending', 'overdue'] as ScheduleStatusFilter[]).map((item) => <button type="button" key={item} className={statusFilter === item ? 'active' : ''} aria-pressed={statusFilter === item} onClick={() => setStatusFilter(item)}><span>{copy[item]}</span><b>{filterCounts[item]}</b></button>)}
        <span className="sr-only" role="status">{filteredOccurrences.length} {copy.results}</span>
      </div>
      {loading && <div className="calendar-state"><Clock3 className="spinning" /><strong>{copy.loading}</strong></div>}
      {error && <div className="calendar-state error"><AlertCircle /><strong>{error}</strong><button className="secondary-button" onClick={load}>{copy.retry}</button></div>}
      {!loading && !error && mode === 'day' && <DayAgenda date={base} items={occurrenceFor(base)} shifts={data?.shifts || []} fa={fa} copy={copy} filtered={statusFilter !== 'all'} onSelect={setSelected} />}
      {!loading && !error && mode === 'week' && <WeekGrid selected={base} items={filteredOccurrences} fa={fa} onDate={onDate} onSelect={setSelected} />}
      {!loading && !error && mode === 'month' && <MonthGrid selected={base} items={filteredOccurrences} fa={fa} onDay={goDay} onSelect={setSelected} />}
    </section>
    {selected && <EventDrawer occurrence={selected} patient={patient} fa={fa} copy={copy} onClose={() => setSelected(null)} onRecord={() => { setSelected(null); onRecordOccurrence(selected) }} />}

    {adHocOpen && (
      <div className="modal-layer">
        <button className="modal-backdrop" onClick={() => setAdHocOpen(false)} tabIndex={-1} />
        <form className="modal task-form" role="dialog" aria-modal="true" onSubmit={submitAdHoc}>
          <button type="button" className="modal-close" onClick={() => setAdHocOpen(false)}><X /></button>
          <h2>{copy.adHocCare}</h2>
          <p style={{ color: 'var(--muted, #64748b)', fontSize: '0.85rem' }}>
            {fa ? `ثبت یک اقدام مراقبتی فوری و خارج از برنامه برای ${patient.full_name}.` : `Record an immediate, unscheduled care action for ${patient.full_name}.`}
          </p>
          <label>
            {fa ? 'عنوان اقدام مراقبتی' : 'Care Action Title'}
            <input
              required
              value={adHocTitle}
              onChange={(e) => setAdHocTitle(e.target.value)}
              placeholder={fa ? 'مثال: استفاده از کیسه آب گرم' : 'e.g. Applied warm compress'}
            />
          </label>
          <label>
            {fa ? 'توضیحات و مشاهدات' : 'Notes & observations'}
            <textarea
              value={adHocNote}
              onChange={(e) => setAdHocNote(e.target.value)}
              placeholder={fa ? 'توضیحات ثبت نتیجه...' : 'Observations during care...'}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => setAdHocOpen(false)}>
              {fa ? 'انصراف' : 'Cancel'}
            </button>
            <button className="primary-button" disabled={adHocSubmitting || !adHocTitle.trim()}>
              <ShieldCheck size={18} />
              {adHocSubmitting ? (fa ? 'در حال ثبت…' : 'Recording…') : (fa ? 'ثبت و تکمیل' : 'Record & Complete')}
            </button>
          </div>
        </form>
      </div>
    )}
  </>
}

function DayAgenda({ date, items, shifts, fa, copy, filtered, onSelect }: { date: Date; items: TaskOccurrence[]; shifts: CalendarData['shifts']; fa: boolean; copy: Record<string, string>; filtered: boolean; onSelect: (item: TaskOccurrence) => void }) {
  const same = shifts.filter((item) => new Date(item.starts_at) <= new Date(`${key(date)}T23:59:59`) && new Date(item.ends_at) >= new Date(`${key(date)}T00:00:00`))
  return <div className="day-agenda"><div className="day-agenda-heading"><h2>{new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : 'en', { weekday: 'long', month: 'long', day: 'numeric' }).format(date)}</h2><span>{items.length} {copy.count}</span></div>{same.length > 0 && <div className="coverage-strip"><UserRound /><span>{copy.coverage}: {same.map((item) => item.caregiver_name).join(' · ')}</span></div>}<div className="agenda-list">{items.map((item) => <button className={`agenda-event ${item.status.toLowerCase()}`} key={item.id} onClick={() => onSelect(item)}><time dir="ltr">{new Date(item.effective_scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span><strong>{item.task_detail.title}</strong><small>{item.task_detail.assigned_to_name || item.task_detail.patient_name}</small></span><b>{statusText(item.status, fa)}</b><ChevronRight /></button>)}{!items.length && <div className="calendar-empty"><CheckCircle2 /><strong>{filtered ? copy.noMatch : copy.noCare}</strong><p>{filtered ? copy.noMatchDetail : copy.noCareDetail}</p></div>}</div></div>
}

function WeekGrid({ selected, items, fa, onDate, onSelect }: { selected: Date; items: TaskOccurrence[]; fa: boolean; onDate: (date: string) => Promise<void>; onSelect: (item: TaskOccurrence) => void }) {
  const start = rangeFor(selected, 'week', fa)[0]; const days = Array.from({ length: 7 }, (_, index) => { const day = new Date(start); day.setDate(day.getDate() + index); return day })
  const locale = fa ? 'fa-IR-u-ca-persian' : 'en'
  return <div className="compact-week-grid"><div className="week-grid-heading"><span />{days.map((day) => <button key={key(day)} onClick={() => onDate(key(day))}><strong>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(day)}</strong><small>{new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(day)}</small></button>)}</div>{Array.from({ length: 15 }, (_, offset) => { const hour = offset + 6; return <div className="week-grid-row" key={hour}><time dir="ltr">{String(hour).padStart(2, '0')}:00</time>{days.map((day) => <div key={`${key(day)}-${hour}`}>{items.filter((item) => sameDay(new Date(item.effective_scheduled_at), day) && new Date(item.effective_scheduled_at).getHours() === hour).map((item) => <button className={`week-event-chip ${item.status.toLowerCase()}`} key={item.id} onClick={() => onSelect(item)}>{item.task_detail.title}</button>)}</div>)}</div>})}</div>
}

function MonthGrid({ selected, items, fa, onDay, onSelect }: { selected: Date; items: TaskOccurrence[]; fa: boolean; onDay: (date: Date) => Promise<void>; onSelect: (item: TaskOccurrence) => void }) {
  const startOfMonth = new Date(selected.getFullYear(), selected.getMonth(), 1); const offset = (startOfMonth.getDay() - (fa ? 6 : 1) + 7) % 7
  const cells = Array.from({ length: Math.ceil((offset + new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate()) / 7) * 7 }, (_, index) => new Date(selected.getFullYear(), selected.getMonth(), index - offset + 1))
  const locale = fa ? 'fa-IR-u-ca-persian' : 'en'; const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 5, (fa ? 6 : 1) + index)))
  return <div className="clean-month"><h2>{new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(selected)}</h2><div className="clean-month-weekdays">{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="clean-month-grid">{cells.map((day) => { const dayItems = items.filter((item) => sameDay(new Date(item.effective_scheduled_at), day)); return <section className={`${day.getMonth() === selected.getMonth() ? '' : 'outside'} ${sameDay(day, selected) ? 'active' : ''}`} key={key(day)}><button className="month-day-button" aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(day)} onClick={() => onDay(day)}>{new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(day)}</button><div>{dayItems.slice(0, 3).map((item) => <button className={`month-task-chip ${item.status.toLowerCase()}`} key={item.id} onClick={() => onSelect(item)}>{item.task_detail.title}</button>)}{dayItems.length > 3 && <button className="month-more" onClick={() => onDay(day)}>+{dayItems.length - 3}</button>}</div></section> })}</div></div>
}

function EventDrawer({ occurrence, patient, fa, copy, onClose, onRecord }: { occurrence: TaskOccurrence; patient: Patient; fa: boolean; copy: Record<string, string>; onClose: () => void; onRecord: () => void }) {
  const scheduled = new Date(occurrence.effective_scheduled_at)
  return <aside className="calendar-event-drawer" role="region" aria-labelledby="calendar-event-title"><button className="modal-close" onClick={onClose} aria-label={copy.close}><X /></button><span className="eyebrow">{copy.details}</span><h2 id="calendar-event-title">{occurrence.task_detail.title}</h2><div className="drawer-patient"><UserRound /><span><strong>{patient.full_name}</strong><small>{patient.room ? `${fa ? 'اتاق' : 'Room'} ${patient.room}` : fa ? 'بیمار انتخاب‌شده' : 'Selected patient'}</small></span></div><dl><div><dt>{copy.schedule}</dt><dd>{scheduled.toLocaleString(fa ? 'fa-IR-u-ca-persian' : undefined)}</dd></div><div><dt>{copy.assigned}</dt><dd>{occurrence.task_detail.assigned_to_name || '—'}</dd></div><div><dt>{copy.safety}</dt><dd>{occurrence.task_detail.safety_notes || (fa ? 'یادداشت ایمنی ویژه‌ای ثبت نشده است.' : 'No additional safety guidance recorded.')}</dd></div></dl><button className="primary-button" onClick={onRecord}><ShieldCheck />{copy.record}</button></aside>
}
