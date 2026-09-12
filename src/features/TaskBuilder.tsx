import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'

import { getCareAssignments, getTasks, getTaskTemplates } from '../lib/api'
import { previewOccurrences, scheduleSummary, todayValue, weekdays, type BuilderFrequency, type TaskCategory, type TaskCreationDraft, type TaskPriority } from '../lib/task-builder'
import type { CareAssignment, OrganizationTaskTemplate, Patient } from '../lib/types'

type Template = {
  id: string
  label: string
  title: string
  category: TaskCategory
  priority: TaskPriority
  time: string
  frequency: BuilderFrequency
  intervalHours?: number
  instructions: string
  expectedOutcome: string
  safetyNotes: string
  equipment: string
}

const defaultTemplates: Template[] = [
  {
    id: 'blood-pressure',
    label: 'Blood pressure check',
    title: 'Blood pressure check',
    category: 'HEALTH',
    priority: 'NORMAL',
    time: '09:30',
    frequency: 'DAILY',
    instructions: 'Allow the patient to rest for five minutes, then record the reading in Health.',
    expectedOutcome: 'A systolic and diastolic reading is recorded.',
    safetyNotes: 'Escalate readings outside the clinician-defined range.',
    equipment: 'Validated blood pressure monitor and appropriate cuff',
  },
  {
    id: 'hydration',
    label: 'Hydration check',
    title: 'Hydration check',
    category: 'HEALTH',
    priority: 'NORMAL',
    time: '11:00',
    frequency: 'DAILY',
    instructions: 'Offer fluids according to the care plan and document any difficulty swallowing or refusal.',
    expectedOutcome: 'Fluids are offered and intake concerns are documented.',
    safetyNotes: 'Follow any fluid restriction or swallowing precautions in the care plan.',
    equipment: 'Approved drink and intake record',
  },
  {
    id: 'assisted-walk',
    label: 'Assisted walk',
    title: 'Assisted walk',
    category: 'ACTIVITY',
    priority: 'NORMAL',
    time: '14:00',
    frequency: 'DAILY',
    instructions: 'Confirm suitable footwear and support the planned walking route.',
    expectedOutcome: 'The planned walk is completed or the reason it could not be completed is recorded.',
    safetyNotes: 'Stop for dizziness, pain, shortness of breath, or unsafe balance.',
    equipment: 'Walking aid if documented in the care plan',
  },
  {
    id: 'reposition',
    label: 'Repositioning support',
    title: 'Repositioning support',
    category: 'PERSONAL_CARE',
    priority: 'HIGH',
    time: '06:00',
    frequency: 'INTERVAL',
    intervalHours: 4,
    instructions: 'Reposition using the documented handling technique and check skin integrity.',
    expectedOutcome: 'Position is changed and any skin concern is recorded.',
    safetyNotes: 'Use the required number of carers and handling equipment.',
    equipment: 'Positioning aids identified in the care plan',
  },
  {
    id: 'meal-support',
    label: 'Meal support',
    title: 'Lunch support',
    category: 'MEAL',
    priority: 'NORMAL',
    time: '12:30',
    frequency: 'DAILY',
    instructions: 'Serve the prescribed meal and provide the documented level of assistance.',
    expectedOutcome: 'Meal support is provided and intake or refusal is documented.',
    safetyNotes: 'Check diet, allergy, texture, and positioning requirements before serving.',
    equipment: 'Meal plan and required adaptive utensils',
  },
]

const categoryGuidance: Record<TaskCategory, string> = {
  HEALTH: 'State the measurement, recording location, and when a clinician should be contacted.',
  MEAL: 'Include diet, texture, assistance, positioning, and fluid instructions.',
  ACTIVITY: 'Include duration, assistance level, mobility aids, and stop conditions.',
  PERSONAL_CARE: 'Include privacy, consent, assistance level, supplies, and skin observations.',
  MEDICATION: 'Use this only for medication support around an existing approved order. Administration remains in Medications.',
  OTHER: 'Describe the action, expected result, and when help is required.',
}

function Dialog({ children, onClose, locale }: { children: ReactNode; onClose: () => void; locale: string }) {
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    dialog?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key !== 'Tab' || !dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previousFocus?.focus() }
  }, [onClose])
  const closeLabel = locale === 'fa' ? 'بستن ساخت وظیفه' : 'Close task builder'
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label={closeLabel} tabIndex={-1} /><section className="modal task-builder" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="task-builder-title" tabIndex={-1}><button className="modal-close" onClick={onClose} aria-label={closeLabel}><X /></button>{children}</section></div>
}

function FieldHint({ children }: { children: ReactNode }) {
  return <small className="field-hint">{children}</small>
}

export function TaskBuilder({ patient, token, existingTitles, onClose, onCreate, locale = 'en', initialStep = 0, initialFrequency = 'DAILY' }: {
  patient: Patient
  token: string
  existingTitles: string[]
  onClose: () => void
  onCreate: (draft: TaskCreationDraft) => void | Promise<void>
  locale?: string
  initialStep?: number
  initialFrequency?: BuilderFrequency
}) {
  const fa = locale === 'fa'
  const text = fa ? { eyebrow: 'فعالیت مراقبتی جدید', title: 'ایجاد وظیفه', intro: 'یک فعالیت مراقبتی ایمن و شفاف برای', steps: ['وظیفه', 'زمان‌بندی', 'جزئیات مراقبت', 'بازبینی'], details: 'جزئیات وظیفه', template: 'شروع از الگوی مراقبتی', blank: 'وظیفه خالی', organization: 'سازمان شما', defaults: 'الگوهای پیش‌فرض Haven', name: 'نام وظیفه', nameHint: 'یک اقدام روشن بنویسید؛ مانند کمک برای دوش گرفتن', category: 'دسته‌بندی', priority: 'اولویت', personal: 'مراقبت شخصی', health: 'بررسی سلامت', meal: 'وعده غذایی', activity: 'فعالیت', medication: 'پشتیبانی دارو', other: 'سایر', low: 'کم', normal: 'معمولی', high: 'زیاد', urgent: 'فوری', medicationBoundary: 'محدوده ایمنی دارو', include: 'مواردی که باید اضافه شود' } : { eyebrow: 'NEW CARE ACTIVITY', title: 'Create a task', intro: 'Build a safe, unambiguous care activity for', steps: ['Task', 'Schedule', 'Care details', 'Review'], details: 'Task details', template: 'Start from a care template', blank: 'Blank task', organization: 'Your organization', defaults: 'Haven defaults', name: 'Task name', nameHint: 'Use a clear action, such as Assisted shower', category: 'Category', priority: 'Priority', personal: 'Personal care', health: 'Health check', meal: 'Meal', activity: 'Activity', medication: 'Medication support', other: 'Other', low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent', medicationBoundary: 'Medication safety boundary', include: 'What to include' }
  const [step, setStep] = useState(initialStep)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<TaskCategory>('PERSONAL_CARE')
  const [priority, setPriority] = useState<TaskPriority>('NORMAL')
  const [assignedTo, setAssignedTo] = useState<number | null>(null)
  const [frequency, setFrequency] = useState<BuilderFrequency>(initialFrequency)
  const [time, setTime] = useState('12:00')
  const [specificDate, setSpecificDate] = useState(todayValue())
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [intervalHours, setIntervalHours] = useState(4)
  const [startsOn, setStartsOn] = useState(todayValue())
  const [endsOn, setEndsOn] = useState('')
  const [windowBefore, setWindowBefore] = useState(0)
  const [windowAfter, setWindowAfter] = useState(30)
  const [instructions, setInstructions] = useState('')
  const [expectedOutcome, setExpectedOutcome] = useState('')
  const [safetyNotes, setSafetyNotes] = useState('')
  const [equipment, setEquipment] = useState('')
  const [requiresNote, setRequiresNote] = useState(false)
  const [requiresPhoto, setRequiresPhoto] = useState(false)
  const [isQuickAction, setIsQuickAction] = useState(false)
  const [organizationTemplates, setOrganizationTemplates] = useState<OrganizationTaskTemplate[]>([])
  const [patientTaskTitles, setPatientTaskTitles] = useState<string[]>(existingTitles)
  const [assignments, setAssignments] = useState<CareAssignment[]>([])
  const [assignmentError, setAssignmentError] = useState('')
  const [error, setError] = useState('')
  const [patientConfirmed, setPatientConfirmed] = useState(false)
  const draftKey = `haven.task-draft.${patient.id}`
  const guidance = fa ? {
    HEALTH: 'اندازه‌گیری، محل ثبت و زمان تماس با پزشک را مشخص کنید.', MEAL: 'رژیم، بافت غذا، میزان کمک، وضعیت نشستن و دستور مایعات را وارد کنید.', ACTIVITY: 'مدت، میزان کمک، ابزار حرکتی و شرایط توقف را وارد کنید.', PERSONAL_CARE: 'حریم خصوصی، رضایت، میزان کمک، وسایل و مشاهده پوست را وارد کنید.', MEDICATION: 'این گزینه فقط برای پشتیبانی دارو در کنار نسخه تأییدشده است. ثبت مصرف در بخش داروها انجام می‌شود.', OTHER: 'اقدام، نتیجه مورد انتظار و زمان درخواست کمک را شرح دهید.',
  } : categoryGuidance

  useEffect(() => {
    let active = true
    getCareAssignments(token, patient.id)
      .then((items) => {
        if (!active) return
        const careTeam = items.filter((item) => item.active && item.user_detail.role !== 'FAMILY')
        setAssignments(careTeam)
        const primary = careTeam.find((item) => item.relationship === 'PRIMARY_CAREGIVER')
        if (primary) setAssignedTo(primary.user)
      })
      .catch(() => { if (active) setAssignmentError('Care-team assignments are unavailable. You can leave this task unassigned.') })
    return () => { active = false }
  }, [patient.id, token])

  useEffect(() => {
    getTaskTemplates(token).then(setOrganizationTemplates).catch(() => setOrganizationTemplates([]))
  }, [token])

  useEffect(() => {
    getTasks(token, patient.id).then((items) => setPatientTaskTitles(items.map((item) => item.title))).catch(() => setPatientTaskTitles(existingTitles))
  }, [existingTitles, patient.id, token])

  const schedule = useMemo<TaskCreationDraft['schedule']>(() => ({
    frequency,
    time,
    specific_date: frequency === 'ONCE' ? specificDate : null,
    interval_hours: frequency === 'INTERVAL' ? intervalHours : null,
    days_of_week: frequency === 'WEEKLY' ? [...days].sort() : [],
    event_reference: '',
    window_before_minutes: windowBefore,
    window_after_minutes: windowAfter,
    starts_on: frequency === 'ONCE' ? null : startsOn || null,
    ends_on: frequency === 'ONCE' ? null : endsOn || null,
  }), [days, endsOn, frequency, intervalHours, specificDate, startsOn, time, windowAfter, windowBefore])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) || '') as Record<string, unknown>
      if (!saved.title) return
      setTitle(String(saved.title || '')); setCategory((saved.category as TaskCategory) || 'PERSONAL_CARE'); setPriority((saved.priority as TaskPriority) || 'NORMAL'); setAssignedTo(typeof saved.assignedTo === 'number' ? saved.assignedTo : null)
      setFrequency((saved.frequency as BuilderFrequency) || 'DAILY'); setTime(String(saved.time || '12:00')); setSpecificDate(String(saved.specificDate || todayValue())); setDays(Array.isArray(saved.days) ? saved.days.map(Number) : [1, 2, 3, 4, 5]); setIntervalHours(Number(saved.intervalHours || 4)); setStartsOn(String(saved.startsOn || todayValue())); setEndsOn(String(saved.endsOn || '')); setWindowBefore(Number(saved.windowBefore || 0)); setWindowAfter(Number(saved.windowAfter || 30)); setInstructions(String(saved.instructions || '')); setExpectedOutcome(String(saved.expectedOutcome || '')); setSafetyNotes(String(saved.safetyNotes || '')); setEquipment(String(saved.equipment || '')); setRequiresNote(Boolean(saved.requiresNote)); setRequiresPhoto(Boolean(saved.requiresPhoto))
    } catch { /* no usable local draft */ }
  }, [draftKey])

  useEffect(() => {
    const draft = { title, category, priority, assignedTo, frequency, time, specificDate, days, intervalHours, startsOn, endsOn, windowBefore, windowAfter, instructions, expectedOutcome, safetyNotes, equipment, requiresNote, requiresPhoto }
    if (title || instructions || safetyNotes) localStorage.setItem(draftKey, JSON.stringify(draft))
  }, [assignedTo, category, days, draftKey, endsOn, equipment, expectedOutcome, frequency, instructions, intervalHours, priority, requiresNote, requiresPhoto, safetyNotes, specificDate, startsOn, time, title, windowAfter, windowBefore])

  const duplicate = patientTaskTitles.some((item) => item.trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase())
  const preview = useMemo(() => previewOccurrences(schedule), [schedule])
  const assigned = assignments.find((item) => item.user === assignedTo)

  const applyTemplate = (templateId: string) => {
    const organizationTemplate = organizationTemplates.find((item) => `org-${item.id}` === templateId)
    if (organizationTemplate) {
      setTitle(organizationTemplate.title); setCategory(organizationTemplate.category); setPriority(organizationTemplate.priority)
      setInstructions(organizationTemplate.instructions); setExpectedOutcome(organizationTemplate.expected_outcome)
      setSafetyNotes(organizationTemplate.safety_notes); setEquipment(organizationTemplate.equipment.join(', '))
      setRequiresNote(organizationTemplate.requires_note); setRequiresPhoto(organizationTemplate.requires_photo)
      const scheduleDefaults = organizationTemplate.schedule_defaults
      if (scheduleDefaults.frequency) setFrequency(scheduleDefaults.frequency)
      if (scheduleDefaults.time) setTime(scheduleDefaults.time.slice(0, 5))
      setError(''); return
    }
    const template = defaultTemplates.find((item) => item.id === templateId)
    if (!template) return
    setTitle(template.title)
    setCategory(template.category)
    setPriority(template.priority)
    setTime(template.time)
    setFrequency(template.frequency)
    setIntervalHours(template.intervalHours || 4)
    setInstructions(template.instructions)
    setExpectedOutcome(template.expectedOutcome)
    setSafetyNotes(template.safetyNotes)
    setEquipment(template.equipment)
    setError('')
  }

  const validateStep = () => {
    if (step === 0 && !title.trim()) return fa ? 'یک نام روشن برای وظیفه وارد کنید.' : 'Enter a clear task name.'
    if (step === 1) {
      if (!time) return fa ? 'زمان وظیفه را انتخاب کنید.' : 'Choose a task time.'
      if (frequency === 'ONCE' && !specificDate) return fa ? 'تاریخ این وظیفه را انتخاب کنید.' : 'Choose the date for this task.'
      if (frequency === 'WEEKLY' && !days.length) return fa ? 'حداقل یک روز هفته را انتخاب کنید.' : 'Choose at least one weekday.'
      if (frequency === 'INTERVAL' && (!intervalHours || intervalHours > 24)) return fa ? 'یک بازه بین ۱ تا ۲۴ ساعت انتخاب کنید.' : 'Choose an interval from 1 to 24 hours.'
      if (endsOn && startsOn && endsOn < startsOn) return fa ? 'تاریخ پایان نمی‌تواند پیش از تاریخ شروع باشد.' : 'The end date cannot be earlier than the start date.'
    }
    if (step === 2 && !instructions.trim()) return fa ? 'دستورهایی وارد کنید که مراقب دیگر بتواند ایمن انجام دهد.' : 'Add instructions that another caregiver can safely follow.'
    return ''
  }

  const next = () => {
    const message = validateStep()
    if (message) { setError(message); return }
    setError('')
    setStep((current) => Math.min(3, current + 1))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!patientConfirmed) { setError(fa ? `تأیید کنید که این وظیفه برای ${patient.full_name} است.` : `Confirm that this task belongs to ${patient.full_name}.`); return }
    await onCreate({
      title: title.trim(),
      category,
      priority,
      assigned_to: assignedTo,
      instructions: instructions.trim(),
      expected_outcome: expectedOutcome.trim(),
      safety_notes: safetyNotes.trim(),
      equipment: equipment.split(',').map((item) => item.trim()).filter(Boolean),
      requires_note: requiresNote,
      requires_photo: requiresPhoto,
      is_quick_action: isQuickAction,
      schedule,
    })
    localStorage.removeItem(draftKey)
  }

  return <Dialog onClose={onClose} locale={locale}>
    <header className="builder-header">
      <span className="eyebrow">{text.eyebrow}</span>
      <h2 id="task-builder-title">{text.title}</h2>
      <p>{text.intro} <strong>{patient.full_name}</strong>.</p>
    </header>
    <ol className="builder-steps" aria-label="Task creation progress">
      {text.steps.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check /> : index + 1}</span><b>{label}</b></li>)}
    </ol>

    <form className="task-form builder-form" onSubmit={submit}>
      {step === 0 && <section className="builder-panel" aria-labelledby="builder-task-heading">
        <h3 id="builder-task-heading"><ClipboardCheck /> {text.details}</h3>
        <label>{text.template}<select defaultValue="" onChange={(event) => applyTemplate(event.target.value)}><option value="">{text.blank}</option>{organizationTemplates.length > 0 && <optgroup label={text.organization}>{organizationTemplates.map((template) => <option key={template.id} value={`org-${template.id}`}>{template.name}</option>)}</optgroup>}<optgroup label={text.defaults}>{defaultTemplates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</optgroup></select></label>
        <label>{text.name}<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} placeholder={text.nameHint} />{duplicate && <FieldHint>{fa ? 'وظیفه‌ای با این نام امروز وجود دارد؛ پیش از ایجاد دوباره آن را بررسی کنید.' : 'A task with this name already appears today. Review it before creating another.'}</FieldHint>}</label>
        <div className="form-row"><label>{text.category}<select value={category} onChange={(event) => setCategory(event.target.value as TaskCategory)}><option value="PERSONAL_CARE">{text.personal}</option><option value="HEALTH">{text.health}</option><option value="MEAL">{text.meal}</option><option value="ACTIVITY">{text.activity}</option><option value="MEDICATION">{text.medication}</option><option value="OTHER">{text.other}</option></select></label><label>{text.priority}<select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}><option value="LOW">{text.low}</option><option value="NORMAL">{text.normal}</option><option value="HIGH">{text.high}</option><option value="URGENT">{text.urgent}</option></select></label></div>
        <div className={`category-guidance ${category === 'MEDICATION' ? 'warning' : ''}`}><ShieldCheck /><span><strong>{category === 'MEDICATION' ? text.medicationBoundary : text.include}</strong><small>{guidance[category]}</small></span></div>
      </section>}

      {step === 1 && <section className="builder-panel" aria-labelledby="builder-schedule-heading">
        <h3 id="builder-schedule-heading"><CalendarDays /> {fa ? 'زمان‌بندی' : 'Schedule'}</h3>
        <div className="frequency-options" role="radiogroup" aria-label={fa ? 'الگوی تکرار' : 'Repeat pattern'}>{([['ONCE', fa ? 'یک‌بار' : 'One time'], ['DAILY', fa ? 'روزانه' : 'Daily'], ['WEEKLY', fa ? 'روزهای هفته' : 'Weekdays'], ['INTERVAL', fa ? 'بازه‌ای' : 'Interval']] as const).map(([value, label]) => <label key={value} className={frequency === value ? 'selected' : ''}><input type="radio" name="frequency" value={value} checked={frequency === value} onChange={() => setFrequency(value)} /><span>{label}</span></label>)}</div>
        <div className="form-row"><label>{frequency === 'INTERVAL' ? (fa ? 'زمان نخست' : 'First time') : (fa ? 'زمان' : 'Time')}<input dir="ltr" type="time" required value={time} onChange={(event) => setTime(event.target.value)} /></label>{frequency === 'ONCE' ? <label>{fa ? 'تاریخ' : 'Date'}<input dir="ltr" type="date" required min={todayValue()} value={specificDate} onChange={(event) => setSpecificDate(event.target.value)} /></label> : frequency === 'INTERVAL' ? <label>{fa ? 'تکرار هر' : 'Repeat every'}<select value={intervalHours} onChange={(event) => setIntervalHours(Number(event.target.value))}>{[1, 2, 3, 4, 6, 8, 12, 24].map((hours) => <option key={hours} value={hours}>{fa ? `${hours} ساعت` : `${hours} hour${hours === 1 ? '' : 's'}`}</option>)}</select></label> : <span />}</div>
        {frequency === 'ONCE' && <label className="checkbox quick-action-toggle" style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}><input type="checkbox" checked={isQuickAction} onChange={(event) => setIsQuickAction(event.target.checked)} /><span>{fa ? 'ذخیره به عنوان اقدام سریع در صفحه امروز' : 'Save as Pinned Quick Action on Today Dashboard'}</span></label>}
        {frequency === 'WEEKLY' && <fieldset className="weekday-picker"><legend>{fa ? 'روزهای هفته' : 'Days of week'}</legend>{weekdays.map(([value, label]) => <label key={value} className={days.includes(value) ? 'selected' : ''}><input type="checkbox" checked={days.includes(value)} onChange={() => setDays((current) => current.includes(value) ? current.filter((day) => day !== value) : [...current, value])} /><span>{fa ? ['دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه', 'یکشنبه'][value - 1] : label}</span></label>)}</fieldset>}
        {frequency !== 'ONCE' && <div className="form-row"><label>{fa ? 'شروع از' : 'Starts on'}<input dir="ltr" type="date" min={todayValue()} value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label>{fa ? 'پایان در' : 'Ends on'} <small>{fa ? '(اختیاری)' : '(optional)'}</small><input dir="ltr" type="date" min={startsOn || todayValue()} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div>}
        <fieldset className="window-fields"><legend>{fa ? 'بازه ایمن ثبت انجام' : 'Safe completion window'}</legend><div className="form-row"><label>{fa ? 'دقیقه پیش از موعد' : 'Minutes before'}<input type="number" min="0" max="1440" value={windowBefore} onChange={(event) => setWindowBefore(Number(event.target.value))} /></label><label>{fa ? 'دقیقه پس از موعد' : 'Minutes after'}<input type="number" min="0" max="1440" value={windowAfter} onChange={(event) => setWindowAfter(Number(event.target.value))} /></label></div><FieldHint>{fa ? 'پس از این بازه، Haven می‌تواند وظیفه را عقب‌افتاده کرده و سیاست تشدید سازمان را اجرا کند.' : 'After this window, Haven can mark the task overdue and follow the organization’s escalation policy.'}</FieldHint></fieldset>
        <div className="schedule-callout"><Clock3 /><span><strong>{fa ? 'پیش‌نمایش زمان‌بندی' : 'Schedule preview'}</strong><small>{scheduleSummary(schedule, fa ? 'fa' : 'en')}</small></span></div>
      </section>}

      {step === 2 && <section className="builder-panel" aria-labelledby="builder-care-heading">
        <h3 id="builder-care-heading"><ShieldCheck /> {fa ? 'جزئیات مراقبت' : 'Care details'}</h3>
        <label>{fa ? 'دستورهای مراقبت' : 'Care instructions'}<textarea required value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={fa ? 'مراحل ایمنی را که مراقب دیگر باید انجام دهد بنویسید.' : 'Write the steps another caregiver should follow safely.'} /><FieldHint>{guidance[category]}</FieldHint></label>
        <label>{fa ? 'نتیجه مورد انتظار' : 'Expected outcome'}<textarea value={expectedOutcome} onChange={(event) => setExpectedOutcome(event.target.value)} placeholder={fa ? 'پس از انجام وظیفه چه چیزی باید دیده یا ثبت شود؟' : 'What should be observed or recorded when this task is complete?'} /></label>
        <label>{fa ? 'نکات ایمنی' : 'Safety notes'}<textarea value={safetyNotes} onChange={(event) => setSafetyNotes(event.target.value)} placeholder={fa ? 'شرایط توقف، احتیاط‌ها یا زمان درخواست کمک' : 'Stop conditions, precautions, or when to request help'} /></label>
        <fieldset className="completion-policy"><legend>{fa ? 'یادداشت هنگام ثبت انجام' : 'Completion note policy'}</legend><p>{fa ? 'مشخص کنید مراقب برای نتیجه «طبق برنامه انجام شد» ملزم به نوشتن توضیح باشد یا نه.' : 'Choose whether a caregiver must write a note when recording “completed as planned”.'}</p><div><label className={!requiresNote ? 'selected' : ''}><input type="radio" name="completion-note-policy" checked={!requiresNote} onChange={() => setRequiresNote(false)} /><span><strong>{fa ? 'اختیاری' : 'Optional'}</strong><small>{fa ? 'ثبت سریع انجام؛ مراقب در صورت نیاز توضیح می‌نویسد.' : 'Fast completion; the caregiver adds context only when useful.'}</small></span></label><label className={requiresNote ? 'selected' : ''}><input type="radio" name="completion-note-policy" checked={requiresNote} onChange={() => setRequiresNote(true)} /><span><strong>{fa ? 'الزامی' : 'Required'}</strong><small>{fa ? 'بدون توضیح، ثبت انجام پذیرفته نمی‌شود.' : 'Completion cannot be saved until a note is entered.'}</small></span></label></div><small className="field-hint">{fa ? 'برای انجام ناقص، عدم امکان انجام یا رد بیمار، توضیح همیشه الزامی است.' : 'A note is always required for partial, unable, or refused care.'}</small></fieldset>
        <label className="checkbox completion-photo-policy"><input type="checkbox" checked={requiresPhoto} onChange={(event) => setRequiresPhoto(event.target.checked)} /><span>{fa ? 'عکس انجام الزامی باشد' : 'Require a completion photo'}</span></label>
        <label>{fa ? 'تجهیزات یا وسایل' : 'Equipment or supplies'}<input value={equipment} onChange={(event) => setEquipment(event.target.value)} placeholder={fa ? 'مانند ابزار راه‌رفتن، دستکش، دستگاه تأییدشده' : 'e.g. walking aid, gloves, validated monitor'} /></label>
        <label>{fa ? 'واگذاری به' : 'Assign to'}<select value={assignedTo ?? ''} onChange={(event) => setAssignedTo(event.target.value ? Number(event.target.value) : null)}><option value="">{fa ? 'وظیفه تیم مراقبت بدون مسئول' : 'Unassigned care team task'}</option>{assignments.map((item) => <option key={item.id} value={item.user}>{item.user_detail.display_name} · {item.user_detail.role.toLocaleLowerCase()}</option>)}</select>{assignmentError && <FieldHint>{assignmentError}</FieldHint>}</label>
      </section>}

      {step === 3 && <section className="builder-panel review-panel" aria-labelledby="builder-review-heading">
        <h3 id="builder-review-heading"><Sparkles /> {fa ? 'بازبینی پیش از ایجاد' : 'Review before creating'}</h3>
        {duplicate && <div className="builder-warning"><AlertCircle /><span><strong>{fa ? 'تکراری احتمالی' : 'Possible duplicate'}</strong><small>{fa ? `وظیفه‌ای با نام «${title}» از قبل در برنامه امروز وجود دارد.` : `A task named “${title}” already appears in today’s plan.`}</small></span></div>}
        <div className="review-patient"><span className="avatar"><UserRound /></span><span><small>{fa ? 'بیمار' : 'PATIENT'}</small><strong>{patient.full_name}</strong><b>{patient.room ? (fa ? `اتاق ${patient.room}` : `Room ${patient.room}`) : (fa ? 'اتاق ثبت نشده است' : 'No room recorded')}</b></span></div>
        <dl className="review-grid"><div><dt>{fa ? 'وظیفه' : 'Task'}</dt><dd>{title}</dd></div><div><dt>{fa ? 'اولویت' : 'Priority'}</dt><dd><span className={`priority-badge ${priority.toLocaleLowerCase()}`}>{fa ? ({ LOW: 'کم', NORMAL: 'معمولی', HIGH: 'زیاد', URGENT: 'فوری' }[priority]) : priority.toLocaleLowerCase()}</span></dd></div><div><dt>{fa ? 'دسته‌بندی' : 'Category'}</dt><dd>{fa ? ({ PERSONAL_CARE: 'مراقبت شخصی', HEALTH: 'بررسی سلامت', MEAL: 'وعده غذایی', ACTIVITY: 'فعالیت', MEDICATION: 'پشتیبانی دارو', OTHER: 'سایر' }[category]) : category.replace('_', ' ').toLocaleLowerCase()}</dd></div><div><dt>{fa ? 'مسئول' : 'Assigned to'}</dt><dd>{assigned?.user_detail.display_name || (fa ? 'تیم مراقبت · بدون مسئول' : 'Care team · unassigned')}</dd></div><div><dt>{fa ? 'یادداشت انجام' : 'Completion note'}</dt><dd>{requiresNote ? (fa ? 'الزامی' : 'Required') : (fa ? 'اختیاری' : 'Optional')}</dd></div><div><dt>{fa ? 'عکس انجام' : 'Completion photo'}</dt><dd>{requiresPhoto ? (fa ? 'الزامی' : 'Required') : (fa ? 'اختیاری' : 'Optional')}</dd></div>{isQuickAction && <div><dt>{fa ? 'اقدام سریع' : 'Quick action'}</dt><dd>{fa ? 'سنجاق در صفحه امروز' : 'Pinned on Today Dashboard'}</dd></div>}<div className="wide"><dt>{fa ? 'زمان‌بندی' : 'Schedule'}</dt><dd>{scheduleSummary(schedule, fa ? 'fa' : 'en')}</dd></div><div className="wide"><dt>{fa ? 'دستورها' : 'Instructions'}</dt><dd>{instructions}</dd></div></dl>
        <div className="occurrence-preview"><strong>{fa ? 'دفعات بعدی' : 'Next occurrences'}</strong>{preview.length ? <ol>{preview.map((date) => <li key={date.toISOString()}><CalendarDays /><span>{new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}</span></li>)}</ol> : <p>{fa ? 'در تاریخ‌های انتخاب‌شده رویدادی وجود ندارد.' : 'No occurrences fall within the selected dates.'}</p>}</div>
        <label className="verification-check"><input type="checkbox" checked={patientConfirmed} onChange={(event) => setPatientConfirmed(event.target.checked)} /><span>{fa ? <>تأیید می‌کنم این وظیفه برای <strong>{patient.full_name}</strong> است و زمان‌بندی و دستورها درست هستند.</> : <>I confirm this task is for <strong>{patient.full_name}</strong> and the schedule and instructions are correct.</>}</span></label>
      </section>}

      {error && <div className="login-error" role="alert"><AlertCircle />{error}</div>}
      <footer className="builder-actions">{step > 0 && <button type="button" className="secondary-button" onClick={() => { setError(''); setStep((current) => current - 1) }}><ChevronLeft /> {fa ? 'بازگشت' : 'Back'}</button>}<span />{step < 3 ? <button type="button" className="primary-button" onClick={next}>{fa ? 'ادامه' : 'Continue'} <ChevronRight /></button> : <button type="submit" className="primary-button"><ClipboardCheck /> {fa ? 'ایجاد وظیفه مراقبتی' : 'Create care task'}</button>}</footer>
    </form>
  </Dialog>
}
