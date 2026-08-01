import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, CalendarCheck, ClipboardCheck, FileText, History, MessageCircle, Pill, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'

import { PageHeader } from '../components/PageHeader'
import { getAuditEvents, getConversations, getMessages, getReports, getVitals } from '../lib/api'
import type { DashboardResponse, Patient, Session } from '../lib/types'

type TimelineKind = 'task' | 'medication' | 'vital' | 'message' | 'handover' | 'audit'
type TimelineEvent = { id: string; kind: TimelineKind; at: string; title: string; detail: string; status?: string }
const filterKey = (patientId: number) => `haven.timeline-filter.${patientId}`

export default function TimelineView({ session, patient, dashboard, locale }: { session: Session; patient: Patient; dashboard: DashboardResponse; locale: string }) {
  const fa = locale === 'fa'
  const t = useMemo(() => fa ? {
    eyebrow: 'نمای یکپارچه مراقبت', title: 'خط زمانی بیمار', description: `مرور رویدادهای مهم مراقبت برای ${patient.full_name}.`, search: 'جستجو در خط زمانی', all: 'همه', task: 'وظایف', medication: 'داروها', vital: 'علائم حیاتی', message: 'پیام‌ها', handover: 'تحویل شیفت', audit: 'حسابرسی', refresh: 'به‌روزرسانی', loading: 'در حال بارگذاری رویدادها', none: 'رویدادی برای این فیلتر پیدا نشد', error: 'خط زمانی کامل بارگذاری نشد؛ رویدادهای در دسترس نمایش داده می‌شوند.', saved: 'فیلتر ذخیره شد', occurrence: 'فعالیت مراقبتی', dose: 'رویداد دارو', recorded: 'ثبت علائم حیاتی', sent: 'پیام', report: 'گزارش تحویل شیفت', action: 'اقدام حسابرسی', filter: 'فیلتر خط زمانی',
  } : {
    eyebrow: 'UNIFIED CARE VIEW', title: 'Patient timeline', description: `Review the important care events for ${patient.full_name}.`, search: 'Search this timeline', all: 'All', task: 'Tasks', medication: 'Medications', vital: 'Vitals', message: 'Messages', handover: 'Handovers', audit: 'Audit', refresh: 'Refresh', loading: 'Loading events', none: 'No events match this filter', error: 'The full timeline could not be loaded; available events are shown.', saved: 'Filter saved', occurrence: 'Care activity', dose: 'Medication event', recorded: 'Vital recorded', sent: 'Message', report: 'Shift handover', action: 'Audit action', filter: 'Timeline filter',
  }, [fa, patient.full_name])
  const [events, setEvents] = useState<TimelineEvent[]>(() => baseEvents(dashboard, t, fa))
  const [filter, setFilter] = useState<TimelineKind | 'all'>(() => (localStorage.getItem(filterKey(patient.id)) as TimelineKind | 'all') || 'all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [vitals, reports, audits, conversations] = await Promise.all([getVitals(session.token, patient.id), getReports(session.token, patient.id), getAuditEvents(session.token, patient.id), getConversations(session.token, patient.id)])
      const messages = (await Promise.all(conversations.map((conversation) => getMessages(session.token, conversation.id).then((items) => items.slice(-20))))).flat()
      setEvents([
        ...baseEvents(dashboard, t, fa),
        ...vitals.map((item) => ({ id: `vital-${item.id}`, kind: 'vital' as const, at: item.recorded_at, title: `${t.recorded}: ${vitalLabel(item.type, fa)}`, detail: `${item.value}${item.secondary_value ? `/${item.secondary_value}` : ''} ${item.unit} · ${item.recorded_by_name || 'Haven'}` })),
        ...reports.map((item) => ({ id: `report-${item.id}`, kind: 'handover' as const, at: item.created_at, title: t.report, detail: item.observations || item.concerns || item.author_name })),
        ...audits.map((item) => ({ id: `audit-${item.id}`, kind: 'audit' as const, at: item.created_at, title: t.action, detail: auditDetail(item.summary, fa) })),
        ...messages.map((item) => ({ id: `message-${item.id}`, kind: 'message' as const, at: item.created_at, title: t.sent, detail: `${item.sender_name}: ${item.body || (item.voice_note ? (fa ? 'یادداشت صوتی' : 'Voice note') : (fa ? 'پیوست امن' : 'Secure attachment'))}`, status: item.urgent ? 'urgent' : undefined })),
      ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()))
    } catch {
      setEvents(baseEvents(dashboard, t, fa)); setError(t.error)
    } finally { setLoading(false) }
  }, [dashboard, fa, patient.id, session.token, t])
  useEffect(() => { load() }, [load])
  useEffect(() => { localStorage.setItem(filterKey(patient.id), filter) }, [filter, patient.id])
  const filtered = useMemo(() => events.filter((event) => (filter === 'all' || event.kind === filter) && `${event.title} ${event.detail}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [events, filter, query])
  const labels: Record<TimelineKind | 'all', string> = { all: t.all, task: t.task, medication: t.medication, vital: t.vital, message: t.message, handover: t.handover, audit: t.audit }
  return <>
    <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} action={<button className="secondary-button" onClick={load} disabled={loading}><RefreshCw className={loading ? 'spinning' : ''} />{t.refresh}</button>} />
    {error && <div className="workspace-notice"><AlertCircle />{error}</div>}
    <section className="main-card timeline-view">
      <div className="timeline-tools"><label className="search-field"><Search /><span className="sr-only">{t.search}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} /></label><div className="timeline-filters" role="group" aria-label={t.filter}><SlidersHorizontal />{(Object.keys(labels) as (TimelineKind | 'all')[]).map((kind) => <button key={kind} className={filter === kind ? 'active' : ''} onClick={() => setFilter(kind)}>{labels[kind]}</button>)}</div></div>
      {loading && <div className="empty-care"><RefreshCw className="spinning" /><strong>{t.loading}</strong></div>}
      {!loading && <div className="timeline-list">{filtered.map((event) => <article className={`timeline-event ${event.kind}`} key={event.id}><span className="timeline-event-icon">{icon(event.kind)}</span><div className="timeline-event-copy"><div className="timeline-event-meta"><time>{new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.at))}</time>{event.status && <b className={event.status}>{statusLabel(event.status, fa)}</b>}</div><strong><bdi>{event.title}</bdi></strong><p><bdi>{event.detail}</bdi></p></div></article>)}{!filtered.length && <div className="empty-care compact"><History /><strong>{t.none}</strong></div>}</div>}
    </section>
  </>
}

function baseEvents(dashboard: DashboardResponse, text: { occurrence: string; dose: string }, fa = false) {
  return [
    ...dashboard.occurrences.map((item) => ({ id: `task-${item.id}`, kind: 'task' as const, at: item.completed_at || item.effective_scheduled_at, title: `${text.occurrence}: ${item.task_detail.title}`, detail: `${statusLabel(item.status, fa)} · ${item.task_detail.assigned_to_name || item.task_detail.patient_name}`, status: item.status.toLowerCase() })),
    ...dashboard.dose_logs.map((item) => ({ id: `dose-${item.id}`, kind: 'medication' as const, at: item.administered_at || item.scheduled_at, title: `${text.dose}: ${item.medication_name}`, detail: `${item.dose} ${item.unit} · ${item.route}`, status: item.status.toLowerCase() })),
  ]
}

function statusLabel(status: string, fa: boolean) {
  const normalized = status.toLowerCase()
  const labels: Record<string, [string, string]> = {
    pending: ['Pending', 'در انتظار'], done: ['Done', 'انجام شد'], missed: ['Missed', 'انجام نشد'], skipped: ['Skipped', 'رد شد'], delayed: ['Delayed', 'با تأخیر'],
    scheduled: ['Scheduled', 'برنامه‌ریزی‌شده'], given: ['Given', 'ثبت شد'], held: ['Held', 'نگه‌داشته شد'], refused: ['Refused', 'رد شد'], urgent: ['Urgent', 'فوری'],
  }
  return labels[normalized]?.[fa ? 1 : 0] || status
}

function vitalLabel(type: string, fa: boolean) {
  const labels: Record<string, [string, string]> = { BLOOD_PRESSURE: ['Blood pressure', 'فشار خون'], OXYGEN: ['Oxygen', 'اکسیژن'], TEMPERATURE: ['Temperature', 'دما'], WEIGHT: ['Weight', 'وزن'], PAIN: ['Pain', 'درد'] }
  return labels[type]?.[fa ? 1 : 0] || type.replaceAll('_', ' ')
}

function auditDetail(summary: string, fa: boolean) {
  if (!fa) return summary
  const prefixes: [string, string][] = [
    ['Recorded completed outcome for ', 'نتیجه انجام کار ثبت شد: '],
    ['Recorded correction for ', 'اصلاح ثبت شد: '],
    ['Created task ', 'وظیفه ایجاد شد: '],
    ['Updated task ', 'وظیفه به‌روزرسانی شد: '],
  ]
  const match = prefixes.find(([english]) => summary.startsWith(english))
  return match ? `${match[1]}${summary.slice(match[0].length)}` : summary
}

function icon(kind: TimelineKind) {
  if (kind === 'task') return <ClipboardCheck />
  if (kind === 'medication') return <Pill />
  if (kind === 'vital') return <Activity />
  if (kind === 'message') return <MessageCircle />
  if (kind === 'handover') return <FileText />
  return <CalendarCheck />
}
