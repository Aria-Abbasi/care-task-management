import { FormEvent, useCallback, useEffect, useState } from 'react'
import { AlertCircle, Archive, ClipboardCheck, Pencil, Plus, RefreshCw, X } from 'lucide-react'

import { PageHeader } from '../components/PageHeader'
import { deactivateTask, getCareAssignments, getTasks, updateTask } from '../lib/api'
import { scheduleSummary, type TaskCreationDraft } from '../lib/task-builder'
import type { CareAssignment, Patient, Session, TaskSchedule, TaskTemplate } from '../lib/types'

const summary = (schedule: TaskSchedule, locale: string) => scheduleSummary({
  frequency: schedule.frequency,
  time: schedule.time?.slice(0, 5) || '',
  specific_date: schedule.specific_date,
  interval_hours: schedule.interval_hours,
  days_of_week: schedule.days_of_week,
  event_reference: schedule.event_reference,
  window_before_minutes: schedule.window_before_minutes,
  window_after_minutes: schedule.window_after_minutes,
  starts_on: schedule.starts_on,
  ends_on: schedule.ends_on,
} as TaskCreationDraft['schedule'], locale)

export default function TaskManagementView({ session, patient, onAdd, notify, locale }: { session: Session; patient: Patient; onAdd: () => void; notify: (message: string) => void; locale: string }) {
  const fa = locale === 'fa'
  const t = fa ? { eyebrow: 'برنامه مراقبتی', title: 'همه وظایف', description: `فعالیت‌های تکرارشونده، یک‌باره، فعال و بایگانی‌شده برای ${patient.full_name}.`, create: 'ایجاد وظیفه', retry: 'تلاش دوباره', search: 'جستجوی وظایف', placeholder: 'جستجو در تعریف همه وظایف', archived: 'نمایش بایگانی‌شده‌ها', task: 'وظیفه', schedule: 'زمان‌بندی', status: 'وضعیت', actions: 'عملیات', loading: 'در حال بارگذاری وظایف', none: 'هیچ وظیفه منطبقی پیدا نشد', noneText: 'یک وظیفه ایجاد کنید یا موارد بایگانی‌شده را نمایش دهید.', details: 'جزئیات مراقبت ثبت نشده', noSchedule: 'بدون زمان‌بندی', active: 'فعال', archivedStatus: 'بایگانی‌شده', edit: 'ویرایش', duplicate: 'کپی برای وظیفه جدید', archive: 'بایگانی', selected: 'انتخاب شده', assign: 'واگذاری انتخاب‌شده‌ها', chooseCaregiver: 'انتخاب مراقب' } : { eyebrow: 'CARE PLAN', title: 'All tasks', description: `Recurring, one-time, active, and archived care activities for ${patient.full_name}.`, create: 'Create task', retry: 'Try again', search: 'Search tasks', placeholder: 'Search all task definitions', archived: 'Include archived', task: 'Task', schedule: 'Actual schedule', status: 'Status', actions: 'Actions', loading: 'Loading tasks', none: 'No matching task definitions', noneText: 'Create a task or include archived records.', details: 'No care details recorded', noSchedule: 'No schedule', active: 'active', archivedStatus: 'archived', edit: 'Edit', duplicate: 'Duplicate as new task', archive: 'Archive', selected: 'selected', assign: 'Assign selected', chooseCaregiver: 'Choose caregiver' }
  const [tasks, setTasks] = useState<TaskTemplate[]>([])
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<TaskTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assignments, setAssignments] = useState<CareAssignment[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkAssignee, setBulkAssignee] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setTasks(await getTasks(session.token, patient.id, showArchived ? undefined : true)) }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Tasks could not be loaded.') }
    finally { setLoading(false) }
  }, [patient.id, session.token, showArchived])
  useEffect(() => { load() }, [load])
  useEffect(() => { getCareAssignments(session.token, patient.id).then((items) => setAssignments(items.filter((item) => item.active && item.user_detail.role !== 'FAMILY'))).catch(() => setAssignments([])) }, [patient.id, session.token])
  const shown = tasks.filter((task) => `${task.title} ${task.instructions}`.toLowerCase().includes(query.toLowerCase()))
  const duplicate = (task: TaskTemplate) => {
    const schedule = task.schedules[0]
    localStorage.setItem(`haven.task-draft.${patient.id}`, JSON.stringify({ title: `${task.title} ${fa ? '(کپی)' : '(copy)'}`, category: task.category, priority: task.priority, assignedTo: task.assigned_to, instructions: task.instructions, expectedOutcome: task.expected_outcome, safetyNotes: task.safety_notes, equipment: task.equipment.join(', '), requiresNote: task.requires_note, requiresPhoto: task.requires_photo, frequency: schedule?.frequency || 'DAILY', time: schedule?.time?.slice(0, 5) || '12:00', specificDate: schedule?.specific_date || '', days: schedule?.days_of_week || [1, 2, 3, 4, 5], intervalHours: schedule?.interval_hours || 4, startsOn: schedule?.starts_on || '', endsOn: schedule?.ends_on || '', windowBefore: schedule?.window_before_minutes || 0, windowAfter: schedule?.window_after_minutes || 30 }))
    notify(fa ? 'پیش‌نویس کپی وظیفه آماده است' : 'Task copy is ready to review')
    onAdd()
  }
  const bulkAssign = async () => {
    if (!bulkAssignee || !selectedIds.length) return
    await Promise.all(selectedIds.map((id) => updateTask(session.token, id, { assigned_to: Number(bulkAssignee) })))
    setSelectedIds([]); await load(); notify(fa ? 'وظایف انتخاب‌شده واگذار شدند' : 'Selected tasks assigned')
  }
  return <>
    <PageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} action={<button className="primary-button" onClick={onAdd}><Plus />{t.create}</button>} />
    {error && <div className="workspace-notice"><AlertCircle />{error}<button className="text-button" onClick={load}>{t.retry}</button></div>}
    <section className="main-card table-card"><div className="table-tools"><label className="search-field"><span className="sr-only">{t.search}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.placeholder} /></label><label className="checkbox"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>{t.archived}</span></label></div>{selectedIds.length > 0 && <div className="task-bulk-toolbar"><strong>{selectedIds.length} {t.selected}</strong><select value={bulkAssignee} onChange={(event) => setBulkAssignee(event.target.value)}><option value="">{t.chooseCaregiver}</option>{assignments.map((item) => <option key={item.user} value={item.user}>{item.user_detail.display_name}</option>)}</select><button className="primary-button" disabled={!bulkAssignee} onClick={bulkAssign}>{t.assign}</button></div>}
      <div className="task-table"><div className="table-head"><span>{t.task}</span><span>{t.schedule}</span><span>{t.status}</span><span>{t.actions}</span></div>
        {loading && <div className="empty-care"><RefreshCw className="spinning" /><strong>{t.loading}</strong></div>}
        {!loading && shown.map((task) => <article className="table-row" key={task.id}><span className="table-task"><label className="task-select"><input type="checkbox" checked={selectedIds.includes(task.id)} onChange={() => setSelectedIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} /><span className="sr-only">{task.title}</span></label><ClipboardCheck /><span><strong>{task.title}</strong><small>{task.expected_outcome || task.instructions || t.details}</small></span></span><span className="task-schedule" dir={fa ? 'rtl' : undefined}>{task.schedules.map((schedule) => summary(schedule, locale)).join(' · ') || t.noSchedule}</span><span><b className={`status-pill ${task.active ? 'done' : 'overdue'}`}>{task.active ? t.active : t.archivedStatus}</b></span><span className="med-actions"><button className="secondary-button" onClick={() => setEditing(task)}><Pencil />{t.edit}</button><button className="secondary-button" onClick={() => duplicate(task)}>{t.duplicate}</button>{task.active && <button className="danger-button" onClick={async () => { await deactivateTask(session.token, task.id); await load(); notify(fa ? 'وظیفه بایگانی شد؛ سابقه اجرا حفظ شده است' : 'Task archived; historical occurrences were preserved') }}><Archive />{t.archive}</button>}</span></article>)}
        {!loading && !shown.length && <div className="empty-care"><ClipboardCheck /><strong>{t.none}</strong><p>{t.noneText}</p></div>}
      </div>
    </section>
    {editing && <TaskEditDialog locale={locale} task={editing} onClose={() => setEditing(null)} onSave={async (values) => { await updateTask(session.token, editing.id, values); setEditing(null); await load(); notify(fa ? 'تعریف وظیفه به‌روزرسانی شد' : 'Task definition updated') }} />}
  </>
}

function TaskEditDialog({ task, onClose, onSave, locale }: { task: TaskTemplate; onClose: () => void; onSave: (values: Partial<TaskTemplate>) => Promise<void>; locale: string }) {
  const fa = locale === 'fa'
  const [title, setTitle] = useState(task.title)
  const [instructions, setInstructions] = useState(task.instructions)
  const [expectedOutcome, setExpectedOutcome] = useState(task.expected_outcome)
  const [safetyNotes, setSafetyNotes] = useState(task.safety_notes)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); try { await onSave({ title, instructions, expected_outcome: expectedOutcome, safety_notes: safetyNotes }) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : fa ? 'به‌روزرسانی وظیفه ممکن نشد.' : 'Task could not be updated.') } }
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label={fa ? 'بستن ویرایشگر وظیفه' : 'Close task editor'} /><form className="modal task-form" role="dialog" aria-modal="true" aria-labelledby="edit-task-title" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose} aria-label={fa ? 'بستن' : 'Close'}><X /></button><h2 id="edit-task-title">{fa ? 'ویرایش تعریف وظیفه' : 'Edit task definition'}</h2><label>{fa ? 'نام وظیفه' : 'Task name'}<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>{fa ? 'دستورهای مراقبت' : 'Care instructions'}<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label><label>{fa ? 'نتیجه مورد انتظار' : 'Expected outcome'}<textarea value={expectedOutcome} onChange={(event) => setExpectedOutcome(event.target.value)} /></label><label>{fa ? 'یادداشت‌های ایمنی' : 'Safety notes'}<textarea value={safetyNotes} onChange={(event) => setSafetyNotes(event.target.value)} /></label>{error && <div className="login-error"><AlertCircle />{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>{fa ? 'انصراف' : 'Cancel'}</button><button className="primary-button">{fa ? 'ذخیره وظیفه' : 'Save task'}</button></div></form></div>
}
