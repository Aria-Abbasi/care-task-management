import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, FileText, HeartPulse, Send, Sun } from 'lucide-react'
import { acknowledgeReport, getReports, getShifts } from '../lib/api'
import type { Patient, Session, ShiftAssignment, ShiftReport } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

export default function ReportsView({ session, patient, taskCount, vitalCount, onSend, notify }: { session: Session; patient: Patient; taskCount: number; vitalCount: number; onSend: (observations: string, concerns: string) => Promise<void>; notify: (message: string) => void }) {
  const [observations, setObservations] = useState('')
  const [concerns, setConcerns] = useState('')
  const [reports, setReports] = useState<ShiftReport[]>([])
  const [shifts, setShifts] = useState<ShiftAssignment[]>([])
  const [sending, setSending] = useState(false)
  const load = useCallback(() => Promise.all([getReports(session.token, patient.id), getShifts(session.token, patient.id)]).then(([nextReports, nextShifts]) => { setReports(nextReports); setShifts(nextShifts) }), [patient.id, session.token])
  useEffect(() => { load().catch(() => undefined) }, [load])
  const submit = async () => { setSending(true); try { await onSend(observations, concerns); setObservations(''); setConcerns(''); await load() } finally { setSending(false) } }
  const acknowledge = async (id: number) => { await acknowledgeReport(session.token, id); await load(); notify('Handover acknowledged') }
  const nextShift = shifts.find((shift) => new Date(shift.ends_at) > new Date())
  return <><PageHeader eyebrow="CARE CONTINUITY" title="Reports & handovers" description="History, acknowledgement, and real shift ownership." /><div className="reports-grid"><section className="main-card report-composer"><span className="eyebrow"><Sun size={16} /> CURRENT SHIFT</span><h2>Shift handover</h2><div className="report-stats"><div><CheckCircle2 /><strong>{taskCount}</strong><span>Tasks complete</span></div><div><AlertCircle /><strong>{concerns ? 1 : 0}</strong><span>Issues reported</span></div><div><HeartPulse /><strong>{vitalCount}</strong><span>Vitals recorded</span></div></div><label>Observations<textarea value={observations} onChange={(event) => setObservations(event.target.value)} placeholder="What should the next caregiver know?" /></label><label>Concerns or follow-up<textarea value={concerns} onChange={(event) => setConcerns(event.target.value)} /></label><button className="primary-button" onClick={submit} disabled={sending || !observations.trim()}><Send />{sending ? 'Sending…' : 'Send handover'}</button></section><aside><div className="side-card next-caregiver"><span className="eyebrow">NEXT ASSIGNMENT</span><h3>{nextShift?.caregiver_name || 'No upcoming shift'}</h3>{nextShift && <p>{new Date(nextShift.starts_at).toLocaleString()}–{new Date(nextShift.ends_at).toLocaleTimeString()}</p>}</div></aside></div>
    <section className="main-card recent-readings"><div className="subsection-heading"><h3>Report history</h3></div>{reports.map((report) => <article className="audit-row" key={report.id}><FileText /><div><strong>{report.author_name}</strong><p>{report.observations}</p>{report.concerns && <small>Concern: {report.concerns}</small>}<small>{new Date(report.created_at).toLocaleString()}</small></div>{report.acknowledged_at ? <b>Acknowledged by {report.acknowledged_by_name}</b> : <button className="secondary-button" onClick={() => acknowledge(report.id)}>Acknowledge</button>}</article>)}{!reports.length && <div className="empty-care compact"><FileText /><strong>No handovers yet</strong></div>}</section></>
}
