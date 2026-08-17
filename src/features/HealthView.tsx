import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, HeartPulse, Plus, RefreshCw, Thermometer, Weight } from 'lucide-react'

import { PageHeader } from '../components/PageHeader'
import { getVitalOptions, getVitals } from '../lib/api'
import type { Patient, Session, VitalRecord, VitalTypeOption } from '../lib/types'

const defaultLabels: Record<string, string> = {
  BLOOD_PRESSURE: 'Blood pressure',
  HEART_RATE: 'Heart rate',
  OXYGEN: 'Oxygen saturation',
  TEMPERATURE: 'Temperature',
  WEIGHT: 'Weight',
  GLUCOSE: 'Blood glucose',
}

function chartPath(values: number[], min: number, max: number) {
  return values.map((value, index) => `${index ? 'L' : 'M'} ${40 + index * (620 / Math.max(values.length - 1, 1))} ${190 - ((value - min) / Math.max(max - min, 1)) * 140}`).join(' ')
}

export default function HealthView({ session, patient, latest, onRecord, canRecord = true, locale = 'en' }: { session: Session; patient: Patient; latest: VitalRecord[]; onRecord: () => void; canRecord?: boolean; locale?: string }) {
  const fa = locale === 'fa'
  const t = fa ? {
    eyebrow: 'روندهای بالینی', title: 'اندازه‌گیری‌های سلامت', description: 'سوابق تاریخی با منشأ مشخص؛ هشدارها هرگز تشخیص خودکار ایجاد نمی‌کنند.',
    record: 'ثبت علائم حیاتی', retry: 'تلاش دوباره', vitalType: 'نوع اندازه‌گیری', months: '۳ ماه', days: (days: number) => `${days} روز`,
    history: 'روند', systolic: 'سیستولیک', diastolic: 'دیاستولیک', loading: 'در حال بارگذاری اندازه‌گیری‌ها',
    loadError: 'سوابق تاریخی تازه‌سازی نشدند. داده‌های قبلی نمایش داده می‌شوند.', noRange: 'هنوز اندازه‌گیری ثبت نشده است',
    noRangeDetail: 'برای شروع روند این مورد، نخستین اندازه‌گیری را ثبت کنید.', firstReading: 'ثبت نخستین اندازه‌گیری',
    provenance: 'منشأ ثبت', noReading: 'بدون ثبت', imported: 'رکورد واردشده',
  } : {
    eyebrow: 'CLINICAL TRENDS', title: 'Health readings', description: 'Historical records with source provenance; alerts never make an automatic diagnosis.',
    record: 'Record vital', retry: 'Try again', vitalType: 'Vital type', months: '3 months', days: (days: number) => `${days} days`,
    history: 'history', systolic: 'Systolic', diastolic: 'Diastolic', loading: 'Loading readings',
    loadError: 'Historical readings could not be refreshed. Saved readings are shown.', noRange: 'No readings recorded yet',
    noRangeDetail: 'Record the first reading to start this trend.', firstReading: 'Record first reading',
    provenance: 'Record provenance', noReading: 'No reading', imported: 'Imported record',
  }

  const [vitals, setVitals] = useState<VitalRecord[]>(latest)
  const [range, setRange] = useState(7)
  const [type, setType] = useState<string>('BLOOD_PRESSURE')
  const [customOptions, setCustomOptions] = useState<VitalTypeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [records, optionsData] = await Promise.all([
        getVitals(session.token, patient.id),
        getVitalOptions(session.token).catch(() => ({ all: [] })),
      ])
      setVitals(records)
      if (optionsData?.all) {
        setCustomOptions(optionsData.all)
      }
    } catch {
      setVitals(latest)
      setError(t.loadError)
    } finally {
      setLoading(false)
    }
  }, [latest, patient.id, session.token, t.loadError])

  useEffect(() => { load() }, [load])

  const vitalLabels = useMemo(() => {
    const base: Record<string, string> = locale === 'fa' ? {
      BLOOD_PRESSURE: 'فشار خون',
      HEART_RATE: 'ضربان قلب',
      OXYGEN: 'اشباع اکسیژن',
      TEMPERATURE: 'دما',
      WEIGHT: 'وزن',
      GLUCOSE: 'قند خون',
    } : defaultLabels

    const map: Record<string, string> = { ...base }
    customOptions.forEach((opt) => {
      if (opt.is_custom) {
        map[opt.type] = opt.name
      }
    })
    vitals.forEach((record) => {
      if (!map[record.type]) {
        map[record.type] = record.type.replace(/_/g, ' ')
      }
    })
    return map
  }, [locale, customOptions, vitals])

  const points = useMemo(() => vitals.filter((item) => item.type === type && Date.now() - new Date(item.recorded_at).getTime() <= range * 86_400_000).slice(-40), [range, type, vitals])
  const primary = points.map((item) => Number(item.value)).filter(Number.isFinite)
  const secondary = type === 'BLOOD_PRESSURE' ? points.map((item) => Number(item.secondary_value)).filter(Number.isFinite) : []
  const allValues = [...primary, ...secondary]
  const min = Math.min(...allValues, 0)
  const max = Math.max(...allValues, 1)

  return (
    <>
      <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} action={canRecord ? <button className="primary-button" onClick={onRecord}><Plus />{t.record}</button> : undefined} />
      {error && <div className="workspace-notice"><AlertCircle />{error}<button className="text-button" onClick={load}>{t.retry}</button></div>}
      <section className={`main-card bp-chart ${points.length || loading ? '' : 'empty-chart'}`}>
        <div className="chart-title">
          <div>
            <span className="icon-box rose"><HeartPulse /></span>
            <span>
              <small>{(vitalLabels[type] || type).toUpperCase()}</small>
              <h3>{points.at(-1)?.value || '—'}{points.at(-1)?.secondary_value ? `/${points.at(-1)?.secondary_value}` : ''} <em>{points.at(-1)?.unit || ''}</em></h3>
            </span>
          </div>
          <select aria-label={t.vitalType} value={type} onChange={(event) => setType(event.target.value)}>
            {Object.entries(vitalLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </div>
        <div className="chart-tabs">
          {[7, 30, 90].map((days) => <button className={range === days ? 'active' : ''} onClick={() => setRange(days)} key={days}>{days === 90 ? t.months : t.days(days)}</button>)}
        </div>
        {points.length > 0 && (
          <>
            <svg viewBox="0 0 700 230" role="img" aria-label={`${vitalLabels[type] || type} ${t.history}`}>
              {[35, 85, 135, 185].map((y) => <line key={y} x1="35" y1={y} x2="680" y2={y} className="grid-line" />)}
              <path d={chartPath(primary, min, max)} className="chart-line systolic" />
              {secondary.length > 0 && <path d={chartPath(secondary, min, max)} className="chart-line diastolic" />}
            </svg>
            {type === 'BLOOD_PRESSURE' && <div className="chart-legend"><span><i className="systolic" />{t.systolic}</span><span><i className="diastolic" />{t.diastolic}</span></div>}
          </>
        )}
        {loading && <div className="empty-care compact health-empty"><RefreshCw className="spinning" /><strong>{t.loading}</strong></div>}
        {!loading && !points.length && (
          <div className="empty-care compact health-empty">
            <Activity />
            <strong>{t.noRange}</strong>
            <p>{t.noRangeDetail}</p>
            {canRecord && <button className="secondary-button" onClick={onRecord}><Plus />{t.firstReading}</button>}
          </div>
        )}
      </section>
      <div className="vital-cards">
        <Vital icon={<Activity />} label={vitalLabels.OXYGEN || 'Oxygen'} record={latest.find((item) => item.type === 'OXYGEN')} locale={locale} noReading={t.noReading} />
        <Vital icon={<Weight />} label={vitalLabels.WEIGHT || 'Weight'} record={latest.find((item) => item.type === 'WEIGHT')} locale={locale} noReading={t.noReading} />
        <Vital icon={<Thermometer />} label={vitalLabels.TEMPERATURE || 'Temperature'} record={latest.find((item) => item.type === 'TEMPERATURE')} locale={locale} noReading={t.noReading} />
      </div>
      <section className="main-card recent-readings">
        <div className="subsection-heading"><h3>{t.provenance}</h3></div>
        {[...vitals].reverse().slice(0, 50).map((item) => (
          <div className="reading-row" key={item.id}>
            <span>{new Date(item.recorded_at).toLocaleString(fa ? 'fa-IR-u-ca-persian' : undefined)}</span>
            <strong>{vitalLabels[item.type] || item.type}</strong>
            <b>{item.value}{item.secondary_value ? `/${item.secondary_value}` : ''} {item.unit}</b>
            <em>{item.source_system || 'Haven'}</em>
            <span>{item.recorded_by_name || t.imported}</span>
          </div>
        ))}
      </section>
    </>
  )
}

function Vital({ icon, label, record, locale, noReading }: { icon: React.ReactNode; label: string; record?: VitalRecord; locale: string; noReading: string }) {
  return (
    <article className="vital-card">
      <div className="icon-box blue">{icon}</div>
      <small>{label}</small>
      <h3>{record?.value || '—'}<em>{record?.unit || ''}</em></h3>
      <p>{record ? new Date(record.recorded_at).toLocaleString(locale === 'fa' ? 'fa-IR-u-ca-persian' : undefined) : noReading}</p>
    </article>
  )
}
