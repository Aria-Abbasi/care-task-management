import { useEffect, useMemo, useState } from 'react'
import { Activity, HeartPulse, Plus, Thermometer, Weight } from 'lucide-react'
import { getVitals } from '../lib/api'
import type { Patient, Session, VitalRecord } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

const labels: Record<VitalRecord['type'], string> = { BLOOD_PRESSURE: 'Blood pressure', HEART_RATE: 'Heart rate', OXYGEN: 'Oxygen saturation', TEMPERATURE: 'Temperature', WEIGHT: 'Weight', GLUCOSE: 'Blood glucose' }

export default function HealthView({ session, patient, latest, onRecord }: { session: Session; patient: Patient; latest: VitalRecord[]; onRecord: () => void }) {
  const [vitals, setVitals] = useState<VitalRecord[]>(latest)
  const [range, setRange] = useState(7)
  const [type, setType] = useState<VitalRecord['type']>('BLOOD_PRESSURE')
  useEffect(() => { getVitals(session.token, patient.id).then(setVitals).catch(() => setVitals(latest)) }, [latest, patient.id, session.token])
  const points = useMemo(() => vitals.filter((item) => item.type === type && Date.now() - new Date(item.recorded_at).getTime() <= range * 86_400_000).slice(-40), [range, type, vitals])
  const numeric = points.map((item) => Number(item.value)).filter(Number.isFinite)
  const min = Math.min(...numeric, 0); const max = Math.max(...numeric, 1)
  const path = points.map((item, index) => `${index ? 'L' : 'M'} ${40 + index * (620 / Math.max(points.length - 1, 1))} ${190 - ((Number(item.value) - min) / Math.max(max - min, 1)) * 140}`).join(' ')
  return <><PageHeader eyebrow="CLINICAL TRENDS" title="Health readings" description="Historical records with source provenance; alerts never make an automatic diagnosis." action={<button className="primary-button" onClick={onRecord}><Plus />Record vital</button>} /><section className="main-card bp-chart"><div className="chart-title"><div><span className="icon-box rose"><HeartPulse /></span><span><small>{labels[type].toUpperCase()}</small><h3>{points.at(-1)?.value || '—'} <em>{points.at(-1)?.unit || ''}</em></h3></span></div><select value={type} onChange={(event) => setType(event.target.value as VitalRecord['type'])}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div><div className="chart-tabs">{[7, 30, 90].map((days) => <button className={range === days ? 'active' : ''} onClick={() => setRange(days)} key={days}>{days === 90 ? '3 months' : `${days} days`}</button>)}</div><svg viewBox="0 0 700 230" role="img" aria-label={`${labels[type]} history`}>{[35, 85, 135, 185].map((y) => <line key={y} x1="35" y1={y} x2="680" y2={y} className="grid-line" />)}{path && <path d={path} className="chart-line systolic" />}</svg>{!points.length && <div className="empty-care compact"><Activity /><strong>No readings in this range</strong></div>}</section><div className="vital-cards"><Vital icon={<Activity />} label="Oxygen" record={latest.find((item) => item.type === 'OXYGEN')} /><Vital icon={<Weight />} label="Weight" record={latest.find((item) => item.type === 'WEIGHT')} /><Vital icon={<Thermometer />} label="Temperature" record={latest.find((item) => item.type === 'TEMPERATURE')} /></div><section className="main-card recent-readings"><div className="subsection-heading"><h3>Record provenance</h3></div>{[...vitals].reverse().slice(0, 50).map((item) => <div className="reading-row" key={item.id}><span>{new Date(item.recorded_at).toLocaleString()}</span><strong>{labels[item.type]}</strong><b>{item.value}{item.secondary_value ? `/${item.secondary_value}` : ''} {item.unit}</b><em>{item.source_system || 'Haven'}</em><span>{item.recorded_by_name || 'Imported record'}</span></div>)}</section></>
}

function Vital({ icon, label, record }: { icon: React.ReactNode; label: string; record?: VitalRecord }) { return <article className="vital-card"><div className="icon-box blue">{icon}</div><small>{label}</small><h3>{record?.value || '—'}<em>{record?.unit || ''}</em></h3><p>{record ? new Date(record.recorded_at).toLocaleString() : 'No reading'}</p></article> }
