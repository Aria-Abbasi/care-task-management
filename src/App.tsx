import { CSSProperties, FormEvent, lazy, ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, AlertCircle, ArrowLeft, Bell, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ClipboardCheck, Clock3, HeartPulse, Home,
  Menu, MessageCircle, MoreHorizontal, Plus, Search, Settings,
  ShieldCheck, Sparkles, Stethoscope, Sun, Thermometer,
  X, Pill, Footprints, Utensils, FileText, Cloud, CloudOff, RefreshCw,
  History, RotateCcw, Save, TriangleAlert,
  UserRound, LogOut,
} from 'lucide-react'
import {
  ApiError,
  adjustMedicationStock,
  clearSession,
  completeOccurrenceWithPhoto,
  confirmPasswordReset,
  flushMutationQueue,
  getAuditEvents,
  getCalendar,
  getSignedAuditExport,
  getPatientDashboard,
  getPatients,
  getConversations,
  getShifts,
  delayOccurrence,
  downloadTaskCompletionPhoto,
  loadSession,
  login,
  lookupMedicationBarcode,
  logout,
  mutateOrQueue,
  requestRefill,
  reviewMedicationOrder,
  administerPrn,
  refreshNotifications,
  requestPasswordReset,
  rotateSession,
  updateNotification,
  saveSession,
  saveMedicationOrder,
  skipOccurrence,
} from './lib/api'
import {
  cacheDashboard, cachePatients, clearOfflineData, listMutations, pendingMutationCount, queuedMutationOwners,
  readCachedDashboard, readCachedPatients, removeMutation, retryMutation, type QueuedMutation,
} from './lib/offline'
import { TaskBuilder } from './features/TaskBuilder'
import UnifiedSchedule from './features/UnifiedSchedule'
import ShiftModeView from './features/ShiftModeView'
import type { TaskCreationDraft } from './lib/task-builder'
import type {
  ApiUser, AuditEvent, CalendarData, CareNotification, DashboardResponse, DoseLog, Medication, Patient,
  Session, ShiftAssignment, TaskOccurrence, VitalRecord,
} from './lib/types'

type View = 'today' | 'shift' | 'schedule' | 'tasks' | 'medications' | 'clinical' | 'health' | 'timeline' | 'reports' | 'messages' | 'safety' | 'admin' | 'settings'
type TaskStatus = 'done' | 'overdue' | 'now' | 'upcoming'

type CareTask = {
  id: number
  taskId?: number
  time: string
  title: string
  detail: string
  category: 'medication' | 'health' | 'meal' | 'activity' | 'care'
  status: TaskStatus
  instructions?: string
  localOnly?: boolean
  occurrence?: TaskOccurrence
}

const categoryFromApi: Record<string, CareTask['category']> = {
  MEDICATION: 'medication',
  HEALTH: 'health',
  MEAL: 'meal',
  ACTIVITY: 'activity',
  PERSONAL_CARE: 'care',
  OTHER: 'care',
}

const HealthView = lazy(() => import('./features/HealthView'))
const MessagesView = lazy(() => import('./features/MessagesView'))
const ReportsView = lazy(() => import('./features/ReportsView'))
const TimelineView = lazy(() => import('./features/TimelineView'))
const SecuritySettingsView = lazy(() => import('./features/SettingsView'))
const ClinicalProfileView = lazy(() => import('./features/ClinicalProfileView'))
const AdminView = lazy(() => import('./features/AdminView'))
const TaskManagementView = lazy(() => import('./features/TaskManagementView'))
const viewIds: View[] = ['today', 'shift', 'schedule', 'tasks', 'medications', 'clinical', 'health', 'timeline', 'reports', 'messages', 'safety', 'admin', 'settings']
const viewFromLocation = (): View => {
  const candidate = window.location.pathname.split('/').filter(Boolean).at(-1) as View | undefined
  return candidate && viewIds.includes(candidate) ? candidate : 'today'
}

function mapDashboardTasks(dashboard: DashboardResponse, locale = 'en'): CareTask[] {
  const fa = locale === 'fa'
  const now = Date.now()
  return dashboard.occurrences.map((occurrence) => {
    const scheduled = new Date(occurrence.effective_scheduled_at)
    const minutesFromNow = (scheduled.getTime() - now) / 60_000
    const completionWindow = occurrence.task_detail.schedules.find((schedule) => schedule.id === occurrence.schedule)?.window_after_minutes ?? 30
    let status: TaskStatus = 'upcoming'
    if (occurrence.status === 'DONE') status = 'done'
    else if (occurrence.status === 'MISSED') status = 'overdue'
    else if (minutesFromNow < -completionWindow) status = 'overdue'
    else if (minutesFromNow <= 30) status = 'now'
    return {
      id: occurrence.id,
      taskId: occurrence.task,
      time: scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      title: occurrence.task_detail.title,
      detail: status === 'overdue' ? (fa ? `${Math.max(1, Math.round(-minutesFromNow))} دقیقه از زمان سررسید گذشته است` : `${Math.max(1, Math.round(-minutesFromNow))} minutes overdue`) : occurrence.task_detail.assigned_to_name || occurrence.task_detail.patient_name,
      category: categoryFromApi[occurrence.task_detail.category] || 'care',
      status,
      instructions: occurrence.task_detail.instructions,
      occurrence,
    }
  })
}

function mapOccurrenceTask(occurrence: TaskOccurrence, locale = 'en'): CareTask {
  const scheduled = new Date(occurrence.effective_scheduled_at)
  const fa = locale === 'fa'
  return {
    id: occurrence.id,
    taskId: occurrence.task,
    time: scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    title: occurrence.task_detail.title,
    detail: occurrence.task_detail.assigned_to_name || occurrence.task_detail.patient_name || (fa ? 'بدون مسئول مشخص' : 'No assignee'),
    category: categoryFromApi[occurrence.task_detail.category] || 'care',
    status: occurrence.status === 'DONE' ? 'done' : occurrence.status === 'MISSED' ? 'overdue' : 'upcoming',
    instructions: occurrence.task_detail.instructions,
    occurrence,
  }
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

const navigation: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'today', label: 'Today', icon: Home },
  { id: 'shift', label: 'My shift', icon: Sun },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'tasks', label: 'Tasks', icon: ClipboardCheck },
  { id: 'medications', label: 'Medications', icon: Pill },
  { id: 'clinical', label: 'Clinical profile', icon: Stethoscope },
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'safety', label: 'Safety log', icon: ShieldCheck },
  { id: 'admin', label: 'Administration', icon: Settings },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const persianNavigationLabels: Record<View, string> = {
  today: 'امروز',
  shift: 'شیفت من',
  schedule: 'برنامه',
  tasks: 'وظایف',
  medications: 'داروها',
  clinical: 'پرونده بالینی',
  health: 'سلامت',
  timeline: 'خط زمانی',
  reports: 'گزارش‌ها',
  messages: 'پیام‌ها',
  safety: 'گزارش ایمنی',
  admin: 'مدیریت',
  settings: 'تنظیمات',
}

const categoryIcons = {
  medication: Pill,
  health: Stethoscope,
  meal: Utensils,
  activity: Footprints,
  care: Sparkles,
}

function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [authExpired, setAuthExpired] = useState(false)
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [patients, setPatients] = useState<Patient[]>([])
  const [loadingWorkspace, setLoadingWorkspace] = useState(Boolean(session))
  const [workspaceError, setWorkspaceError] = useState('')
  const [view, setView] = useState<View>(viewFromLocation)
  const [tasks, setTasks] = useState<CareTask[]>([])
  const [selectedTask, setSelectedTask] = useState<CareTask | null>(null)
  const [selectedDose, setSelectedDose] = useState<DoseLog | null>(null)
  const [selectedPrn, setSelectedPrn] = useState<Medication | null>(null)
  const [patientMenu, setPatientMenu] = useState(false)
  const [profileMenu, setProfileMenu] = useState(false)
  const [sidebarProfileMenu, setSidebarProfileMenu] = useState(false)
  const [notifications, setNotifications] = useState<CareNotification[]>([])
  const [notificationPanel, setNotificationPanel] = useState(false)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [syncItems, setSyncItems] = useState<QueuedMutation[]>([])
  const [showAddTask, setShowAddTask] = useState(false)
  const [showVital, setShowVital] = useState(false)
  const [toast, setToast] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [pendingSync, setPendingSync] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [locale, setLocale] = useState(() => localStorage.getItem('haven.locale') || 'en')
  const [currentShifts, setCurrentShifts] = useState<ShiftAssignment[]>([])
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const topProfileRef = useRef<HTMLDivElement>(null)
  const sidebarProfileRef = useRef<HTMLDivElement>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }, [])

  const navigate = useCallback((next: View) => {
    window.history.pushState({ view: next }, '', `/app/${next}${window.location.search}`)
    setView(next)
  }, [])

  useEffect(() => {
    const handleRoute = () => setView(viewFromLocation())
    window.addEventListener('popstate', handleRoute)
    return () => window.removeEventListener('popstate', handleRoute)
  }, [])

  const refreshWorkspace = useCallback(async (activeSession: Session, requestedPatientId?: number, requestedDate?: string) => {
    setLoadingWorkspace(true)
    try {
      const assignedPatients = await getPatients(activeSession.token)
      if (!assignedPatients.length) throw new ApiError('No patient is assigned to this account.', 404)
      setPatients(assignedPatients)
      await cachePatients(assignedPatients, activeSession.user.id)
      const savedPatientId = Number(localStorage.getItem(`haven.patient.${activeSession.user.id}`)) || undefined
      const patientId = requestedPatientId && assignedPatients.some((item) => item.id === requestedPatientId)
        ? requestedPatientId
        : savedPatientId && assignedPatients.some((item) => item.id === savedPatientId)
          ? savedPatientId
          : assignedPatients[0].id
      const nextDashboard = await getPatientDashboard(activeSession.token, patientId, requestedDate || selectedDate)
      localStorage.setItem(`haven.patient.${activeSession.user.id}`, String(patientId))
      setDashboard(nextDashboard)
      setSelectedDate(nextDashboard.date)
      setTasks(mapDashboardTasks(nextDashboard, locale))
      await cacheDashboard(nextDashboard, activeSession.user.id)
      setWorkspaceError('')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSession()
        setAuthExpired(true)
        setDashboard(null)
        setTasks([])
        return
      }
      const cachedPatientId = requestedPatientId || Number(localStorage.getItem(`haven.patient.${activeSession.user.id}`)) || undefined
      const cachedPatients = await readCachedPatients(activeSession.user.id).catch(() => [])
      if (cachedPatients.length) setPatients(cachedPatients)
      const cached = await readCachedDashboard(activeSession.user.id, cachedPatientId).catch(() => null)
      if (cached) {
        setDashboard(cached)
        setTasks(mapDashboardTasks(cached, locale))
        setWorkspaceError('Showing the most recent saved care plan.')
      } else {
        setWorkspaceError(error instanceof Error ? error.message : 'Unable to load the care workspace.')
      }
    } finally {
      setLoadingWorkspace(false)
    }
  }, [locale, selectedDate])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr'
    localStorage.setItem('haven.locale', locale)
  }, [locale])

  useEffect(() => {
    if (!profileMenu && !sidebarProfileMenu) return
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (profileMenu && !topProfileRef.current?.contains(target)) setProfileMenu(false)
      if (sidebarProfileMenu && !sidebarProfileRef.current?.contains(target)) setSidebarProfileMenu(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (profileMenu) {
        event.preventDefault()
        setProfileMenu(false)
        topProfileRef.current?.querySelector<HTMLButtonElement>('.top-profile-trigger')?.focus()
      }
      if (sidebarProfileMenu) {
        event.preventDefault()
        setSidebarProfileMenu(false)
        sidebarProfileRef.current?.querySelector<HTMLButtonElement>('.sidebar-profile-more')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [profileMenu, sidebarProfileMenu])

  useEffect(() => {
    const menu = profileMenu ? topProfileRef.current : sidebarProfileMenu ? sidebarProfileRef.current : null
    if (!menu) return
    const frame = window.requestAnimationFrame(() => menu.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [profileMenu, sidebarProfileMenu])

  const updatePendingCount = useCallback(async () => {
    setPendingSync(session ? await pendingMutationCount(session.user.id).catch(() => 0) : 0)
  }, [session])

  const syncNow = useCallback(async () => {
    if (!session || !navigator.onLine || syncing) return
    setSyncing(true)
    try {
      const result = await flushMutationQueue(session.token, session.user.id)
      await updatePendingCount()
      if (result.synced) {
        await refreshWorkspace(session)
        notify(`${result.synced} offline ${result.synced === 1 ? 'change' : 'changes'} synced`)
      }
      if (result.conflicts || result.failed) {
        setView('safety')
        notify('A queued care record needs review')
      }
    } finally {
      setSyncing(false)
    }
  }, [notify, refreshWorkspace, session, syncing, updatePendingCount])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    updatePendingCount()
    if (session) refreshWorkspace(session)
  }, [refreshWorkspace, session, updatePendingCount])

  useEffect(() => {
    if (!session) return
    const renew = async () => {
      if (new Date(session.expires_at).getTime() - Date.now() > 2 * 60 * 60 * 1000) return
      try {
        const next = await rotateSession(session.token)
        const persistent = Boolean(localStorage.getItem('haven.session'))
        saveSession(next, persistent)
        setSession(next)
      } catch {
        clearSession()
        setAuthExpired(true)
      }
    }
    renew()
    const timer = window.setInterval(renew, 30 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [session])

  useEffect(() => {
    if (!online || !session) return
    let cancelled = false
    const run = async () => {
      setSyncing(true)
      try {
        const result = await flushMutationQueue(session.token, session.user.id)
        if (cancelled) return
        await updatePendingCount()
        if (result.synced) {
          await refreshWorkspace(session)
          notify(`${result.synced} offline ${result.synced === 1 ? 'change' : 'changes'} synced`)
        }
        if (result.conflicts || result.failed) notify('A queued care record needs review')
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [notify, online, refreshWorkspace, session, updatePendingCount])

  const loadNotifications = useCallback(async () => {
    if (!session || !online) return
    const next = await refreshNotifications(session.token)
    setNotifications(next)
    const urgent = next.find((item) => item.state === 'UNREAD' && item.severity === 'CRITICAL')
    if (urgent && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(urgent.title, { body: urgent.message, tag: `haven-${urgent.id}` })
    }
  }, [online, session])

  useEffect(() => {
    if (!session || !dashboard || !online) return
    loadNotifications().catch(() => undefined)
    const interval = window.setInterval(() => loadNotifications().catch(() => undefined), 60_000)
    return () => window.clearInterval(interval)
  }, [dashboard, loadNotifications, online, session])

  useEffect(() => {
    if (!session || !dashboard || !online) return
    Promise.all([getShifts(session.token, dashboard.patient.id), getConversations(session.token, dashboard.patient.id)])
      .then(([shifts, conversations]) => {
        setCurrentShifts(shifts)
        setUnreadMessages(conversations.filter((item) => item.latest_message && item.latest_message.sender !== session.user.id && !item.latest_message.read_receipts.some((receipt) => receipt.user === session.user.id)).length)
      }).catch(() => undefined)
  }, [dashboard, online, session])

  const loadSafetyData = useCallback(async () => {
    if (!session || !dashboard) return
    setSyncItems(await listMutations(session.user.id))
    if (online) setAuditEvents(await getAuditEvents(session.token, dashboard.patient.id))
  }, [dashboard, online, session])

  const exportAudit = async () => {
    if (!session || !dashboard) return
    const report = await getSignedAuditExport(session.token, dashboard.patient.id)
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `haven-audit-${dashboard.patient.id}-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    notify('Signed audit report exported')
  }

  useEffect(() => {
    if (view === 'safety') loadSafetyData().catch(() => undefined)
  }, [loadSafetyData, view])

  const handleLogin = async (loginValue: string, password: string, remember: boolean, mfaCode: string) => {
    const nextSession = await login(loginValue, password, mfaCode)
    const owners = await queuedMutationOwners().catch(() => [])
    if (owners.some((owner) => owner !== nextSession.user.id)) {
      await logout(nextSession.token).catch(() => undefined)
      throw new ApiError('Unsynced changes belong to another caregiver. Sign in with that account first.')
    }
    if (!owners.length) await clearOfflineData().catch(() => undefined)
    saveSession(nextSession, remember)
    setAuthExpired(false)
    setSession(nextSession)
  }

  const recordTaskOutcome = async (task: CareTask, payload: Record<string, unknown>, correction = false) => {
    if (!session || !task.occurrence) return
    const photo = payload.photo
    if (!correction && photo instanceof File) {
      if (!navigator.onLine) throw new ApiError('Photo completion needs a connection so the protected file can upload safely.')
      const values = { ...payload }; delete values.photo
      await completeOccurrenceWithPhoto(session.token, task.occurrence, values, photo)
      setSelectedTask(null); await refreshWorkspace(session, dashboard?.patient.id); notify('Care outcome and protected photo recorded'); return
    }
    const reference = crypto.randomUUID()
    const result = await mutateOrQueue<TaskOccurrence>(session.token, {
      id: reference,
      userId: session.user.id,
      path: `/occurrences/${task.id}/${correction ? 'correct' : 'complete'}/`,
      method: 'POST',
      body: { ...payload, expected_version: task.occurrence.version, client_reference: reference },
    })
    setSelectedTask(null)
    await updatePendingCount()
    if (!result.queued) await refreshWorkspace(session, dashboard?.patient.id)
    else if (result.conflict) setView('safety')
    else {
      const outcome = String(payload.outcome || payload.corrected_outcome || '')
      const nextStatus: CareTask['status'] = outcome === 'COMPLETED' || outcome === 'PARTIAL' ? 'done' : 'overdue'
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus } : item))
    }
    notify(result.conflict ? 'This record changed elsewhere—review the conflict' : result.queued ? 'Care outcome saved offline for review' : correction ? 'Correction added to the audit trail' : 'Care outcome recorded')
  }

  const delayTask = async (task: CareTask, delayedUntil: string, reason: string) => {
    if (!session || !task.occurrence) return
    await delayOccurrence(session.token, task.occurrence, delayedUntil, reason)
    setSelectedTask(null); await refreshWorkspace(session, dashboard?.patient.id); notify('Task delayed with an audited reason')
  }

  const skipTask = async (task: CareTask, outcome: 'UNABLE' | 'REFUSED', note: string) => {
    if (!session || !task.occurrence) return
    await skipOccurrence(session.token, task.occurrence, outcome, note)
    setSelectedTask(null); await refreshWorkspace(session, dashboard?.patient.id); notify('Task skipped with an audited outcome')
  }

  const recordDoseOutcome = async (dose: DoseLog, payload: Record<string, unknown>, action: 'administer' | 'outcome' | 'correct') => {
    if (!session) return
    const reference = crypto.randomUUID()
    const result = await mutateOrQueue<DoseLog>(session.token, {
      id: reference,
      userId: session.user.id,
      path: `/dose-logs/${dose.id}/${action}/`,
      method: 'POST',
      body: { ...payload, expected_version: dose.version, client_reference: reference },
    })
    setSelectedDose(null)
    await updatePendingCount()
    if (!result.queued) await refreshWorkspace(session, dashboard?.patient.id)
    if (result.conflict) setView('safety')
    notify(result.conflict ? 'This dose changed elsewhere—review the conflict' : result.queued ? 'Medication outcome saved offline for review' : action === 'correct' ? 'Dose correction recorded' : 'Medication outcome recorded')
  }

  const recordPrnDose = async (medication: Medication, payload: Record<string, unknown>) => {
    if (!session) return
    await administerPrn(session.token, medication.id, payload)
    setSelectedPrn(null)
    await refreshWorkspace(session, dashboard?.patient.id)
    notify('PRN administration recorded with five-right verification')
  }

  const selectPatient = async (patientId: number) => {
    if (!session || patientId === dashboard?.patient.id) {
      setPatientMenu(false)
      return
    }
    setPatientMenu(false)
    setSelectedTask(null)
    setSelectedDose(null)
    setSelectedPrn(null)
    await refreshWorkspace(session, patientId)
    setView('today')
  }

  const actOnNotification = async (item: CareNotification, action: 'acknowledge' | 'snooze') => {
    if (!session) return
    await updateNotification(session.token, item.id, action, action === 'snooze' ? { minutes: 15 } : undefined)
    await loadNotifications()
    if (dashboard) setAuditEvents(await getAuditEvents(session.token, dashboard.patient.id))
  }

  const resolveSyncItem = async (item: QueuedMutation, action: 'retry' | 'discard') => {
    if (action === 'discard') {
      if (!window.confirm('Discard this unsynced clinical change? The action will be recorded only on this device.')) return
      await removeMutation(item.id)
    } else {
      await retryMutation(item.id)
      await syncNow()
    }
    await updatePendingCount()
    await loadSafetyData()
  }

  const addTask = async (draft: TaskCreationDraft) => {
    const localTask: CareTask = {
      id: -Date.now(),
      status: 'upcoming',
      localOnly: true,
      title: draft.title,
      time: draft.schedule.time,
      category: categoryFromApi[draft.category] || 'care',
      detail: draft.assigned_to ? `${draft.priority.toLocaleLowerCase()} priority · assigned` : `${draft.priority.toLocaleLowerCase()} priority · care team`,
      instructions: draft.instructions,
    }
    setTasks((current) => [...current, localTask])
    setShowAddTask(false)
    if (!session || !dashboard) return
    const reference = crypto.randomUUID()
    try {
      const result = await mutateOrQueue(session.token, {
        id: reference,
        userId: session.user.id,
        path: '/tasks/',
        method: 'POST',
        body: {
          client_reference: reference,
          patient: dashboard.patient.id,
          title: draft.title,
          category: draft.category,
          priority: draft.priority,
          assigned_to: draft.assigned_to,
          instructions: draft.instructions,
          expected_outcome: draft.expected_outcome,
          safety_notes: draft.safety_notes,
          equipment: draft.equipment,
          requires_note: draft.requires_note,
          requires_photo: draft.requires_photo,
          schedules: [draft.schedule],
        },
      })
      await updatePendingCount()
      if (!result.queued) await refreshWorkspace(session)
      notify(result.queued ? 'Task saved offline and queued' : 'Task added to the care plan')
    } catch (error) {
      setTasks((current) => current.filter((item) => item.id !== localTask.id))
      notify(error instanceof Error ? error.message : 'Task could not be created')
    }
  }

  const recordVital = async (payload: Record<string, unknown>) => {
    if (!session || !dashboard) return
    const reference = crypto.randomUUID()
    const result = await mutateOrQueue(session.token, {
      id: reference,
      userId: session.user.id,
      path: '/vitals/',
      method: 'POST',
      body: { ...payload, patient: dashboard.patient.id, client_reference: reference, recorded_at: new Date().toISOString() },
    })
    setShowVital(false)
    await updatePendingCount()
    if (!result.queued) await refreshWorkspace(session)
    else {
      const optimisticVital: VitalRecord = {
        id: -Date.now(),
        patient: dashboard.patient.id,
        patient_name: dashboard.patient.full_name,
        type: payload.type as VitalRecord['type'],
        value: String(payload.value),
        secondary_value: payload.secondary_value ? String(payload.secondary_value) : null,
        unit: String(payload.unit),
        recorded_at: new Date().toISOString(),
        recorded_by: session.user.id,
        recorded_by_name: session.user.display_name,
        note: '',
        source_system: 'Haven',
        external_id: '',
        provenance: {},
      }
      setDashboard((current) => {
        if (!current) return current
        const next = { ...current, latest_vitals: [optimisticVital, ...current.latest_vitals.filter((item) => item.type !== optimisticVital.type)] }
        cacheDashboard(next, session.user.id).catch(() => undefined)
        return next
      })
    }
    notify(result.queued ? 'Vital saved offline and queued' : 'Vital recorded')
  }

  const sendReport = async (observations: string, concerns: string) => {
    if (!session || !dashboard) return
    const reference = crypto.randomUUID()
    const now = new Date()
    const shiftStart = new Date(now)
    shiftStart.setHours(7, 0, 0, 0)
    if (shiftStart >= now) shiftStart.setTime(now.getTime() - 8 * 60 * 60 * 1000)
    const result = await mutateOrQueue(session.token, {
      id: reference,
      userId: session.user.id,
      path: '/shift-reports/',
      method: 'POST',
      body: {
        client_reference: reference,
        patient: dashboard.patient.id,
        shift_started_at: shiftStart.toISOString(),
        shift_ended_at: now.toISOString(),
        observations,
        concerns,
        status: 'SENT',
      },
    })
    await updatePendingCount()
    notify(result.queued ? 'Handover saved offline and queued' : 'Shift report sent')
  }

  const signOut = async () => {
    if (!session) return
    if (!online && pendingSync) {
      notify('Reconnect and sync before signing out')
      return
    }
    try {
      if (online) {
        await flushMutationQueue(session.token, session.user.id)
        const remaining = await pendingMutationCount(session.user.id)
        setPendingSync(remaining)
        if (remaining) {
          notify('Some changes could not sync. Sign out is paused to protect them.')
          return
        }
        await logout(session.token)
      }
    } catch {
      // Local sign-out still clears protected workspace data.
    }
    clearSession()
    await clearOfflineData()
    setDashboard(null)
    setTasks([])
    setAuthExpired(false)
    setSession(null)
  }

  if (window.location.pathname === '/reset-password') return <PasswordReset />
  if (!session || authExpired) return <Login onLogin={handleLogin} />

  if (loadingWorkspace && !dashboard) return <LoadingScreen />

  if (!dashboard) return <WorkspaceError message={workspaceError} onRetry={() => refreshWorkspace(session)} onSignOut={signOut} />

  const patient = dashboard.patient
  const user = session.user
  const isPersian = locale === 'fa'
  const localizedNavigation = navigation.map((item) => ({ ...item, label: isPersian ? persianNavigationLabels[item.id] : item.label }))
  const activeLabel = localizedNavigation.find((item) => item.id === view)?.label
  const visibleNavigation = localizedNavigation.filter((item) => {
    if (user.role === 'FAMILY') return ['today', 'health', 'timeline', 'reports', 'messages', 'settings'].includes(item.id)
    if (user.role === 'DOCTOR') return !['schedule', 'tasks'].includes(item.id)
    if (item.id === 'shift') return user.role === 'CAREGIVER'
    if (item.id === 'admin') return user.role === 'ADMIN'
    return true
  })
  const shellCopy = isPersian ? {
    skip: 'پرش به فضای کاری مراقبت', closeMenu: 'بستن منو', openMenu: 'باز کردن منو',
    assigned: `${patients.length} نفر در مراقبت`, selectPatient: 'انتخاب فرد تحت مراقبت',
    room: (room: string) => `اتاق ${room}`, age: (age: number) => `${age} ساله`,
    workspace: 'فضای کاری مراقبت', careOf: `مراقبت ${patient.first_name}`,
    syncing: 'در حال همگام‌سازی', offline: 'آفلاین', pending: `${pendingSync} مورد در انتظار`, synced: 'همگام است',
    pendingTitle: `${pendingSync} تغییر در انتظار`, offlineTitle: 'در حال کار آفلاین', search: 'جستجو',
    unread: (count: number) => `${count} اعلان خوانده‌نشده`, more: 'بیشتر',
    searchLabel: 'جستجوی فضای کاری مراقبت', searchEyebrow: 'جستجوی سراسری', searchTitle: 'یافتن اطلاعات مراقبت',
    searchPlaceholder: 'جستجوی وظایف و بخش‌های فضای کاری', workspaceSection: 'بخش فضای کاری',
    syncAnnouncement: 'در حال همگام‌سازی پرونده‌های مراقبتی', pendingAnnouncement: `${pendingSync} تغییر نیاز به همگام‌سازی دارد`, syncedAnnouncement: 'پرونده‌های مراقبتی همگام هستند',
    account: 'حساب کاربری', settings: 'تنظیمات فضای کاری', switchPatient: 'تغییر فرد تحت مراقبت', signOut: 'خروج از حساب', protectedSignOut: 'ابتدا تغییرات آفلاین را همگام‌سازی کنید',
    role: { CAREGIVER: 'مراقب', DOCTOR: 'پزشک', FAMILY: 'خانواده', ADMIN: 'مدیر' },
  } : {
    skip: 'Skip to care workspace', closeMenu: 'Close menu', openMenu: 'Open menu',
    assigned: `${patients.length} assigned ${patients.length === 1 ? 'person' : 'people'}`, selectPatient: 'Select person receiving care',
    room: (room: string) => `Room ${room}`, age: (age: number) => `${age} years old`,
    workspace: 'CARE WORKSPACE', careOf: `${patient.first_name}'s care`,
    syncing: 'Syncing', offline: 'Offline', pending: `${pendingSync} pending`, synced: 'Synced',
    pendingTitle: `${pendingSync} pending changes`, offlineTitle: 'Working offline', search: 'Search',
    unread: (count: number) => `${count} unread notifications`, more: 'More',
    searchLabel: 'Search care workspace', searchEyebrow: 'GLOBAL SEARCH', searchTitle: 'Find care information',
    searchPlaceholder: 'Search tasks and workspace sections', workspaceSection: 'Workspace section',
    syncAnnouncement: 'Synchronizing care records', pendingAnnouncement: `${pendingSync} changes need synchronization`, syncedAnnouncement: 'Care records synchronized',
    account: 'Account', settings: 'Workspace settings', switchPatient: 'Switch person receiving care', signOut: 'Sign out', protectedSignOut: 'Sync offline changes before signing out',
    role: { CAREGIVER: 'Caregiver', DOCTOR: 'Clinician', FAMILY: 'Family member', ADMIN: 'Administrator' },
  }
  const roleContext = user.role === 'CAREGIVER'
    ? (isPersian ? ['فضای کاری مراقب', 'مراقبت‌های سررسید و ثبت سریع'] : ['Caregiver workspace', 'Due care and rapid recording'])
    : user.role === 'DOCTOR'
      ? (isPersian ? ['فضای بررسی بالینی', 'نسخه‌ها، روندها و بررسی'] : ['Clinical review workspace', 'Orders, trends, and review'])
      : user.role === 'FAMILY'
        ? (isPersian ? ['فضای اطلاع‌رسانی خانواده', 'به‌روزرسانی‌های ساده و پیام‌رسانی'] : ['Family update workspace', 'Simplified updates and messaging'])
        : (isPersian ? ['مدیریت سازمان', 'نیرو، مجوزها، ارسال و نظارت حسابرسی'] : ['Organization administration', 'Staffing, permissions, delivery, and audit oversight'])
  const searchItems: { id: View; title: string; detail: string }[] = [
    ...localizedNavigation.map((item) => ({ id: item.id, title: item.label, detail: shellCopy.workspaceSection })),
    ...tasks.map((task) => ({ id: 'schedule' as View, title: task.title, detail: `${task.time} · ${task.detail}` })),
    ...dashboard.medications.map((medication) => ({ id: 'medications' as View, title: medication.name, detail: `${medication.dose} ${medication.unit} · ${medication.route}` })),
    ...dashboard.latest_vitals.map((vital) => ({ id: 'health' as View, title: vital.type.replace('_', ' '), detail: `${vital.value}${vital.secondary_value ? `/${vital.secondary_value}` : ''} ${vital.unit}` })),
    ...auditEvents.map((event) => ({ id: 'safety' as View, title: event.summary, detail: event.action.replaceAll('_', ' ') })),
    ...patients.map((item) => ({ id: 'today' as View, title: item.full_name, detail: isPersian ? 'فرد تحت مراقبت' : 'Person receiving care' })),
  ]

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{shellCopy.skip}</a>
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="brand"><BrandMark /><span>haven</span></div>
        <button className="mobile-close" onClick={() => setMobileMenu(false)} aria-label={shellCopy.closeMenu}><X /></button>
        <button className="patient-mini" onClick={() => setPatientMenu(!patientMenu)} aria-expanded={patientMenu} aria-haspopup="listbox">
          <div className="avatar avatar-hassan">{initials(patient.full_name)}</div>
          <div><strong>{patient.full_name}</strong><span>{shellCopy.assigned}</span></div>
          <ChevronDown size={17} />
        </button>
        {patientMenu && <div className="patient-switcher" role="listbox" aria-label={shellCopy.selectPatient}>
          {patients.map((item) => <button key={item.id} role="option" aria-selected={item.id === patient.id} onClick={() => selectPatient(item.id)}>
            <span className="avatar">{initials(item.full_name)}</span><span><strong>{item.full_name}</strong><small>{item.room ? shellCopy.room(item.room) : shellCopy.age(item.age)}</small></span>{item.id === patient.id && <Check />}
          </button>)}
        </div>}
        <nav>
          <span className="nav-heading">{shellCopy.workspace}</span>
          {visibleNavigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => { navigate(id); setMobileMenu(false) }}>
              <Icon size={20} strokeWidth={2} /><span>{label}</span>
              {id === 'messages' && unreadMessages > 0 && <em>{unreadMessages}</em>}
            </button>
          ))}
        </nav>
        <ShiftCard shifts={currentShifts} userId={user.id} locale={locale} />
        <div className="sidebar-profile" ref={sidebarProfileRef}><button className="profile-row" onClick={() => navigate('settings')}><div className="avatar avatar-sarah">{initials(user.display_name)}</div><div><strong>{user.display_name}</strong><span>{shellCopy.role[user.role]}</span></div></button><button className={`sidebar-profile-more ${sidebarProfileMenu ? 'open' : ''}`} onClick={() => { setSidebarProfileMenu((current) => !current); setProfileMenu(false) }} aria-label={shellCopy.more} aria-expanded={sidebarProfileMenu} aria-haspopup="menu" aria-controls="sidebar-account-menu"><MoreHorizontal size={19} /></button>{sidebarProfileMenu && <div id="sidebar-account-menu" className="sidebar-account-menu" role="menu"><div className="sidebar-account-head"><span className="avatar avatar-sarah">{initials(user.display_name)}</span><span><small>{shellCopy.account}</small><strong>{user.display_name}</strong><b>{shellCopy.role[user.role]}</b></span></div><button role="menuitem" onClick={() => { navigate('settings'); setSidebarProfileMenu(false); setMobileMenu(false) }}><Settings /><span>{shellCopy.settings}</span></button><button role="menuitem" onClick={() => { setPatientMenu(true); setSidebarProfileMenu(false) }}><UserRound /><span>{shellCopy.switchPatient}</span></button><button className="sidebar-signout" role="menuitem" onClick={() => { setSidebarProfileMenu(false); signOut() }} disabled={!online && pendingSync > 0} title={!online && pendingSync > 0 ? shellCopy.protectedSignOut : undefined}><LogOut /><span>{shellCopy.signOut}</span></button></div>}</div>
      </aside>

      {mobileMenu && <button className="backdrop" onClick={() => setMobileMenu(false)} aria-label={shellCopy.closeMenu} />}

      <main id="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" onClick={() => setMobileMenu(true)} aria-label={shellCopy.openMenu}><Menu /></button>
            <div><span className="mobile-page-title">{activeLabel}</span><span className="breadcrumb">{shellCopy.careOf} <ChevronRight size={13} /> {activeLabel}</span></div>
          </div>
          <div className="topbar-actions">
            <button className={`sync-status ${syncing ? 'syncing' : !online ? 'offline' : pendingSync ? 'pending' : 'synced'}`} onClick={() => pendingSync ? setView('safety') : syncNow()} title={online ? shellCopy.pendingTitle : shellCopy.offlineTitle} disabled={syncing} aria-live="polite">
              {syncing ? <RefreshCw className="spinning" /> : online ? <Cloud /> : <CloudOff />}
              <span>{syncing ? shellCopy.syncing : !online ? shellCopy.offline : pendingSync ? shellCopy.pending : shellCopy.synced}</span>
            </button>
            <button className="icon-button search-button" aria-label={shellCopy.search} onClick={() => setSearchOpen(true)}><Search size={19} /></button>
            <button className="icon-button notification-button" onClick={() => { setNotificationPanel(!notificationPanel); loadNotifications().catch(() => undefined) }} aria-label={shellCopy.unread(notifications.filter((item) => item.state === 'UNREAD').length)} aria-expanded={notificationPanel}><Bell size={19} />{notifications.some((item) => item.state === 'UNREAD') && <i />}</button>
            <div className="top-profile" ref={topProfileRef}><button className={`top-profile-trigger ${profileMenu ? 'open' : ''}`} onClick={() => { setProfileMenu((current) => !current); setSidebarProfileMenu(false) }} aria-label={shellCopy.account} aria-expanded={profileMenu} aria-haspopup="menu" aria-controls="top-account-menu"><span className="avatar avatar-sarah top-avatar">{initials(user.display_name)}</span></button>{profileMenu && <div id="top-account-menu" className="top-profile-menu" role="menu"><div className="top-profile-summary"><span className="avatar avatar-sarah">{initials(user.display_name)}</span><span><small>{shellCopy.account}</small><strong>{user.display_name}</strong><b>{shellCopy.role[user.role]}</b></span></div><div className={`profile-sync-state ${online ? 'online' : 'offline'}`}>{online ? <Cloud /> : <CloudOff />}<span>{syncing ? shellCopy.syncing : !online ? shellCopy.offline : pendingSync ? shellCopy.pending : shellCopy.synced}</span></div><div className="top-profile-links"><button role="menuitem" onClick={() => { navigate('settings'); setProfileMenu(false) }}><Settings /><span>{shellCopy.settings}</span><ChevronRight /></button><button role="menuitem" onClick={() => { setPatientMenu(true); setProfileMenu(false) }}><UserRound /><span>{shellCopy.switchPatient}</span><ChevronRight /></button></div><button className="top-profile-signout" role="menuitem" onClick={() => { setProfileMenu(false); signOut() }} disabled={!online && pendingSync > 0} title={!online && pendingSync > 0 ? shellCopy.protectedSignOut : undefined}><LogOut /><span>{shellCopy.signOut}</span></button></div>}</div>
          </div>
        </header>

        <div className="content">
          {workspaceError && <div className="workspace-notice"><CloudOff />{workspaceError}</div>}
          <div className="role-context" role="status"><ShieldCheck /> <strong>{roleContext[0]}</strong><span>{roleContext[1]}</span></div>
          {view === 'today' && <Dashboard tasks={tasks} patient={patient} user={user} locale={locale} vitals={dashboard.latest_vitals} onTask={setSelectedTask} onComplete={setSelectedTask} onAdd={() => setShowAddTask(true)} onNavigate={navigate} />}
          {view === 'shift' && <ShiftModeView patient={patient} tasks={tasks} doses={dashboard.dose_logs} offline={!online} pending={pendingSync} locale={locale} onTask={setSelectedTask} onDose={setSelectedDose} />}
          {view === 'schedule' && <Schedule session={session} patient={patient} tasks={tasks} locale={locale} selectedDate={selectedDate} onDate={(date) => refreshWorkspace(session, patient.id, date)} onTask={setSelectedTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'medications' && <Medications session={session} patient={patient} medications={dashboard.medications} doses={dashboard.dose_logs} onDose={setSelectedDose} onPrn={setSelectedPrn} notify={notify} onRefresh={() => refreshWorkspace(session, patient.id, selectedDate)} locale={locale} />}
          <Suspense fallback={<div className="main-card loading-feature"><RefreshCw className="spinning" /> Loading workspace…</div>}>
            {view === 'health' && <HealthView session={session} patient={patient} latest={dashboard.latest_vitals} onRecord={() => setShowVital(true)} canRecord={user.role !== 'FAMILY'} locale={locale} />}
            {view === 'timeline' && <TimelineView session={session} patient={patient} dashboard={dashboard} locale={locale} />}
            {view === 'clinical' && <ClinicalProfileView session={session} patient={patient} locale={locale} />}
            {view === 'admin' && <AdminView session={session} notify={notify} />}
            {view === 'tasks' && <TaskManagementView session={session} patient={patient} onAdd={() => setShowAddTask(true)} notify={notify} locale={locale} />}
            {view === 'reports' && <ReportsView session={session} patient={patient} taskCount={tasks.filter((task) => task.status === 'done').length} vitalCount={dashboard.latest_vitals.length} onSend={sendReport} notify={notify} canAuthor={user.role !== 'FAMILY'} locale={locale} />}
            {view === 'messages' && <MessagesView session={session} patient={patient} notify={notify} locale={locale} />}
            {view === 'settings' && <SecuritySettingsView session={session} onSignOut={signOut} notify={notify} locale={locale} onLocale={setLocale} />}
          </Suspense>
          {view === 'safety' && <><button className="secondary-button audit-export-button" onClick={exportAudit}><FileText /> {locale === 'fa' ? 'دریافت گزارش حسابرسی امضاشده' : 'Export signed audit report'}</button><SafetyLog events={auditEvents} mutations={syncItems} onResolve={resolveSyncItem} onRefresh={loadSafetyData} locale={locale} /></>}
        </div>
      </main>

      <nav className="bottom-nav">
        {visibleNavigation.slice(0, 4).map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><Icon /><span>{label}</span></button>
        ))}
        <button className={!visibleNavigation.slice(0, 4).some((item) => item.id === view) ? 'active' : ''} onClick={() => setMobileMenu(true)}><Menu /><span>{shellCopy.more}</span></button>
      </nav>

      {notificationPanel && <NotificationPanel locale={locale} notifications={notifications} onClose={() => setNotificationPanel(false)} onAction={actOnNotification} />}
      {searchOpen && <Modal onClose={() => { setSearchOpen(false); setSearchQuery('') }} label={shellCopy.searchLabel}><span className="eyebrow">{shellCopy.searchEyebrow}</span><h2>{shellCopy.searchTitle}</h2><label className="search-field"><Search /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={shellCopy.searchPlaceholder} /></label><div className="conversation-list">{searchItems.filter((item) => `${item.title} ${item.detail}`.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase())).slice(0, 18).map((item, index) => <button key={`${item.id}-${item.title}-${index}`} onClick={() => { navigate(item.id); setSearchOpen(false); setSearchQuery('') }}><Search /><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}</div></Modal>}
      {selectedTask && <TaskModal task={selectedTask} patient={patient} onClose={() => setSelectedTask(null)} onSave={recordTaskOutcome} onDelay={delayTask} onSkip={skipTask} onPhoto={(occurrenceId) => downloadTaskCompletionPhoto(session.token, occurrenceId)} locale={locale} />}
      {selectedDose && <DoseModal dose={selectedDose} patient={patient} onClose={() => setSelectedDose(null)} onSave={recordDoseOutcome} locale={locale} />}
      {selectedPrn && <PrnModal medication={selectedPrn} patient={patient} onClose={() => setSelectedPrn(null)} onSave={recordPrnDose} locale={locale} />}
      {showAddTask && session && <TaskBuilder patient={patient} token={session.token} existingTitles={tasks.map((task) => task.title)} onClose={() => setShowAddTask(false)} onCreate={addTask} locale={locale} />}
      {showVital && <VitalModal onClose={() => setShowVital(false)} onSave={recordVital} locale={locale} />}
      <div className="sr-only" aria-live="polite">{syncing ? shellCopy.syncAnnouncement : pendingSync ? shellCopy.pendingAnnouncement : shellCopy.syncedAnnouncement}</div>
      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle2 size={19} />{toast}</div>}
    </div>
  )
}

function BrandMark() {
  return <span className="brand-mark"><HeartPulse size={20} strokeWidth={2.5} /></span>
}

function Login({ onLogin }: { onLogin: (loginValue: string, password: string, remember: boolean, mfaCode: string) => Promise<void> }) {
  const [showPassword, setShowPassword] = useState(false)
  const [loginValue, setLoginValue] = useState('sarah@havencare.com')
  const [password, setPassword] = useState('caregiver')
  const [remember, setRemember] = useState(true)
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onLogin(loginValue, password, remember, mfaCode)
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'Unable to sign in right now.')
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <div className="login-brand"><BrandMark /><span>haven</span></div>
        <div className="story-copy">
          <span className="eyebrow light"><ShieldCheck size={16} /> CARE, WITH CONFIDENCE</span>
          <h1>Every detail cared for.<br />Every moment, clear.</h1>
          <p>A calmer way for caregivers and families to stay connected, informed, and focused on what matters.</p>
        </div>
        <div className="story-quote"><span>“</span><p>Haven gives our family peace of mind, even when we can't be there in person.</p><small>— Layla, family member</small></div>
      </section>
      <section className="login-panel">
        <form onSubmit={submit}>
          <div className="mobile-login-brand"><BrandMark /><span>haven</span></div>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Sign in to continue</h2>
          <p>Access Hassan's care workspace and today's plan.</p>
          <label>Phone number or email<input value={loginValue} onChange={(event) => setLoginValue(event.target.value)} type="text" autoComplete="username" required /></label>
          <div className="password-field"><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" required /></label><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div>
          <label>Authenticator code <small>(if enabled)</small><input value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" /></label>
          <div className="login-options"><label className="checkbox"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Keep me signed in</span></label><button type="button" onClick={async () => { await requestPasswordReset(loginValue); setResetSent(true) }}>Forgot password?</button></div>
          {resetSent && <div className="secure-note"><CheckCircle2 /> If that account exists, reset instructions were sent.</div>}
          {error && <div className="login-error"><AlertCircle />{error}</div>}
          <button className="primary-button login-button" disabled={submitting}>{submitting ? <><RefreshCw className="spinning" /> Signing in…</> : <>Sign in securely <ChevronRight size={18} /></>}</button>
          <div className="secure-note"><ShieldCheck size={16} /> Access is authenticated and limited to assigned care teams.</div>
        </form>
      </section>
    </div>
  )
}

function PasswordReset() {
  const query = new URLSearchParams(window.location.search)
  const uid = query.get('uid') || ''
  const token = query.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== confirmation) { setMessage('Passwords do not match.'); return }
    try { await confirmPasswordReset(uid, token, password); setMessage('Password updated. Return to sign in on all devices.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'This reset link is invalid or expired.') }
  }
  return <div className="state-page"><form className="state-card task-form" onSubmit={submit}><BrandMark /><h2>Reset password</h2><p>This change remotely revokes every existing Haven session.</p><label>New password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>{message && <div className="secure-note" role="status">{message}</div>}<button className="primary-button">Update password</button><a href="/">Return to sign in</a></form></div>
}

function LoadingScreen() {
  return <div className="state-page"><div className="state-card"><BrandMark /><RefreshCw className="spinning state-spinner" /><h2>Loading the care plan</h2><p>Retrieving the latest tasks, medications, and health readings.</p></div></div>
}

function WorkspaceError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return <div className="state-page"><div className="state-card error"><AlertCircle /><h2>Care workspace unavailable</h2><p>{message}</p><button className="primary-button" onClick={onRetry}><RefreshCw /> Try again</button><button className="text-button" onClick={onSignOut}>Sign out</button></div></div>
}

function Dashboard({ tasks, patient, user, locale, vitals, onTask, onComplete, onAdd, onNavigate }: { tasks: CareTask[]; patient: Patient; user: ApiUser; locale: string; vitals: VitalRecord[]; onTask: (task: CareTask) => void; onComplete: (task: CareTask) => void; onAdd: () => void; onNavigate: (view: View) => void }) {
  const complete = tasks.filter((task) => task.status === 'done').length
  const now = tasks.find((task) => task.status === 'now')
  const overdue = tasks.filter((task) => task.status === 'overdue')
  const upcoming = tasks.filter((task) => task.status === 'upcoming').slice(0, 3)
  const progress = tasks.length ? Math.round((complete / tasks.length) * 100) : 0
  const bloodPressure = vitals.find((vital) => vital.type === 'BLOOD_PRESSURE')
  const oxygen = vitals.find((vital) => vital.type === 'OXYGEN')
  const temperature = vitals.find((vital) => vital.type === 'TEMPERATURE')
  const canRecordCare = user.role !== 'FAMILY'
  const isPersian = locale === 'fa'
  const todayLabel = new Intl.DateTimeFormat(isPersian ? 'fa-IR-u-ca-persian' : 'en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase()
  const hour = new Date().getHours()
  const greeting = isPersian ? (hour < 12 ? 'صبح بخیر' : hour < 18 ? 'عصر بخیر' : 'شب بخیر') : (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')
  const copy = isPersian ? {
    needsToday: `${patient.first_name} امروز به این موارد نیاز دارد.`, addTask: 'افزودن وظیفه', activePlan: 'برنامه مراقبتی فعال', inactivePlan: 'برنامه مراقبتی غیرفعال',
    yearsOld: `${patient.age} ساله`, room: patient.room ? ` · اتاق ${patient.room}` : '', bloodPressure: 'فشار خون', oxygen: 'اکسیژن', temperature: 'دما',
    recorded: 'ثبت شده', noReading: 'بدون ثبت', healthProfile: 'مشاهده پرونده سلامت', todaysCare: 'مراقبت‌های امروز',
    completeOf: `${complete} از ${tasks.length} وظیفه انجام شده`, doNow: 'اکنون انجام دهید', markDone: 'ثبت انجام شد', details: 'مشاهده جزئیات', overdue: 'عقب‌افتاده',
    upNext: 'در ادامه', viewSchedule: 'مشاهده برنامه', noTasks: 'وظیفه‌ای برنامه‌ریزی نشده است', noTasksText: 'یک وظیفه مراقبتی اضافه کنید یا منتظر بمانید تا برنامه امروز ایجاد شود.',
    shiftOverview: 'نمای کلی شیفت', complete: 'انجام شده', upcoming: 'در پیش', handover: 'تحویل شیفت', handoverTitle: 'برای تحویل ایمن شیفت آماده‌اید؟',
    handoverText: 'وظیفه بعدی و سابقه تأییدها را بررسی کنید.', reports: 'باز کردن گزارش‌های شیفت', careCircle: 'حلقه مراقبت بیمار', contacts: 'مخاطبان مجاز',
    contactsText: 'از پرونده بالینی بارگذاری شده', familyText: 'گفت‌وگوی ویژه بیمار را باز کنید یا مخاطبان مجاز خانواده را بررسی کنید.', messages: 'باز کردن پیام‌ها',
  } : {
    needsToday: `Here's what ${patient.first_name} needs today.`, addTask: 'Add task', activePlan: 'Active care plan', inactivePlan: 'Care plan inactive',
    yearsOld: `${patient.age} years old`, room: patient.room ? ` · Room ${patient.room}` : '', bloodPressure: 'Blood pressure', oxygen: 'Oxygen', temperature: 'Temperature',
    recorded: 'Recorded', noReading: 'No reading', healthProfile: 'View health profile', todaysCare: "Today's care", completeOf: `${complete} of ${tasks.length} tasks complete`,
    doNow: 'DO NOW', markDone: 'Mark as done', details: 'View details', overdue: 'OVERDUE', upNext: 'Up next', viewSchedule: 'View schedule', noTasks: 'No tasks scheduled', noTasksText: "Add a care task or wait for the schedule worker to generate today's plan.",
    shiftOverview: 'Shift overview', complete: 'complete', upcoming: 'upcoming', handover: 'SHIFT HANDOVER', handoverTitle: 'Ready for a safe handover?',
    handoverText: 'Review the actual next assignment and acknowledgement history.', reports: 'Open shift reports', careCircle: 'PATIENT CARE CIRCLE', contacts: 'Authorized contacts',
    contactsText: 'Loaded from the clinical record', familyText: 'Open the patient-specific conversation or review authorized family contacts.', messages: 'Open messages',
  }
  return (
    <>
      <section className="welcome-row">
        <div><span className="eyebrow">{todayLabel}</span><h1>{greeting}{isPersian ? '، ' : ', '}{user.first_name || user.display_name}</h1><p>{copy.needsToday}</p></div>
        {canRecordCare && <button className="primary-button" onClick={onAdd}><Plus size={19} /> {copy.addTask}</button>}
      </section>

      <section className="patient-hero">
        <div className="patient-identity"><div className="avatar avatar-hassan hero-avatar">{initials(patient.full_name)}<span /></div><div><span className="status-label"><i /> {patient.active ? copy.activePlan : copy.inactivePlan}</span><h2>{patient.full_name}</h2><p>{copy.yearsOld}{copy.room}</p></div></div>
        <div className="hero-stats">
          <div><HeartPulse /><span><small>{copy.bloodPressure}</small><strong>{bloodPressure ? `${Number(bloodPressure.value)}/${Number(bloodPressure.secondary_value)}` : '—'} <em>{bloodPressure?.unit || ''}</em></strong></span><b>{bloodPressure ? copy.recorded : copy.noReading}</b></div>
          <div><Activity /><span><small>{copy.oxygen}</small><strong>{oxygen ? Number(oxygen.value) : '—'}<em>{oxygen?.unit || ''}</em></strong></span><b>{oxygen ? copy.recorded : copy.noReading}</b></div>
          <div><Thermometer /><span><small>{copy.temperature}</small><strong>{temperature ? Number(temperature.value) : '—'}<em>{temperature?.unit || ''}</em></strong></span><b>{temperature ? copy.recorded : copy.noReading}</b></div>
        </div>
        <button className="text-button" onClick={() => onNavigate('health')}>{copy.healthProfile} <ChevronRight size={17} /></button>
      </section>

      <div className="dashboard-grid">
        <section className="timeline-column">
          <div className="section-title"><div><h2>{copy.todaysCare}</h2><p>{copy.completeOf}</p></div><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as CSSProperties}><span>{progress}%</span></div></div>
          {now && <div className="focus-card now-card">
            <div className="focus-label"><span><Clock3 size={15} /> {copy.doNow}</span><strong>{now.time}</strong></div>
            <div className="focus-body"><TaskIcon task={now} large /><div className="focus-copy"><h3>{now.title}</h3><strong>{now.detail}</strong><p>{now.instructions}</p></div></div>
            <div className="focus-actions">{canRecordCare && <button className="complete-button" onClick={() => onComplete(now)}><Check size={20} /> {copy.markDone}</button>}<button className="secondary-button" onClick={() => onTask(now)}>{copy.details}</button></div>
          </div>}
          {overdue.map((task) => <button className="overdue-card" key={task.id} onClick={() => onTask(task)}><span className="overdue-icon"><AlertCircle /></span><span><small>{copy.overdue} · {task.time}</small><strong>{task.title}</strong><em>{task.detail}</em></span><ChevronRight /></button>)}
          <div className="up-next"><div className="subsection-heading"><h3>{copy.upNext}</h3><button onClick={() => onNavigate('schedule')}>{copy.viewSchedule} <ChevronRight size={16} /></button></div>{upcoming.map((task) => <TaskRow key={task.id} task={task} onClick={() => onTask(task)} />)}{!tasks.length && <div className="empty-care"><CheckCircle2 /><strong>{copy.noTasks}</strong><p>{copy.noTasksText}</p></div>}</div>
        </section>

        <aside className="dashboard-side">
          <div className="side-card shift-overview"><div className="subsection-heading"><h3>{copy.shiftOverview}</h3></div><div className="big-progress"><span>{complete}</span><small>{isPersian ? `${tasks.length} وظیفه` : <>of {tasks.length}<br />complete</>}</small></div><div className="linear-progress"><i style={{ width: `${progress}%` }} /></div><div className="overview-legend"><span><i className="green" />{complete} {copy.complete}</span><span><i className="amber" />{tasks.filter((task) => task.status === 'upcoming' || task.status === 'now').length} {copy.upcoming}</span><span><i className="red" />{tasks.filter((task) => task.status === 'overdue').length} {copy.overdue.toLowerCase()}</span></div></div>
          <div className="side-card handover-card"><span className="eyebrow"><ClipboardCheck size={15} /> {copy.handover}</span><h3>{copy.handoverTitle}</h3><p>{copy.handoverText}</p><button className="secondary-button" onClick={() => onNavigate('reports')}>{copy.reports} <ChevronRight size={17} /></button></div>
          <div className="side-card family-card"><div className="family-head"><div className="avatar avatar-layla"><MessageCircle size={18} /></div><div><small>{copy.careCircle}</small><strong>{copy.contacts}</strong><span>{copy.contactsText}</span></div></div><p>{copy.familyText}</p><button onClick={() => onNavigate('messages')}>{copy.messages} <ChevronRight size={16} /></button></div>
        </aside>
      </div>
    </>
  )
}

function ShiftCard({ shifts, userId, locale }: { shifts: ShiftAssignment[]; userId: number; locale: string }) {
  const now = Date.now()
  const isPersian = locale === 'fa'
  const shift = shifts.find((item) => item.caregiver === userId && new Date(item.ends_at).getTime() > now)
  if (!shift) return <div className="shift-card"><div><Sun size={18} /><span>{isPersian ? 'شیفت فعالی ندارید' : 'No active shift'}</span></div><small>{isPersian ? 'برای بررسی برنامه‌ها، گزارش‌ها را باز کنید' : 'Open Reports to review assignments'}</small></div>
  const start = new Date(shift.starts_at).getTime()
  const end = new Date(shift.ends_at).getTime()
  const progress = Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))
  const remainingMinutes = Math.max(0, Math.round((end - now) / 60_000))
  const status = isPersian ? ({ SCHEDULED: 'برنامه‌ریزی‌شده', ACCEPTED: 'پذیرفته‌شده', IN_PROGRESS: 'در حال انجام', COMPLETED: 'پایان‌یافته' }[shift.status] || shift.status) : shift.status.replace('_', ' ').toLowerCase()
  const formatTime = (value: number) => new Intl.DateTimeFormat(isPersian ? 'fa-IR-u-ca-persian' : undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  const remaining = isPersian ? `${Math.floor(remainingMinutes / 60)} ساعت و ${remainingMinutes % 60} دقیقه باقی‌مانده` : `${Math.floor(remainingMinutes / 60)}h ${remainingMinutes % 60}m remaining`
  return <div className="shift-card"><div><Sun size={18} /><span>{status}</span></div><strong dir="ltr">{formatTime(start)} — {formatTime(end)}</strong><small>{remaining}</small><div className="shift-progress"><i style={{ width: `${progress}%` }} /></div></div>
}

function PageHeader({ eyebrow, title, description, action, className = '' }: { eyebrow: string; title: string; description: string; action?: ReactNode; className?: string }) {
  return <section className={`page-header ${className}`}><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</section>
}

export function LegacySchedule({ tasks, locale, selectedDate, onDate, onTask, onAdd }: { tasks: CareTask[]; locale: string; selectedDate: string; onDate: (date: string) => Promise<void>; onTask: (task: CareTask) => void; onAdd: () => void }) {
  const selected = new Date(`${selectedDate}T12:00:00`)
  const calendarLocale = locale === 'fa' ? 'fa-IR-u-ca-persian' : 'en'
  const dates = Array.from({ length: 7 }, (_, index) => { const date = new Date(selected); date.setDate(date.getDate() + index - 3); return date })
  return <><PageHeader eyebrow="CARE CALENDAR" title="Schedule" description={`Care plan for ${new Intl.DateTimeFormat(calendarLocale, { dateStyle: 'full' }).format(selected)}.`} action={<button className="primary-button" onClick={onAdd}><Plus size={19} /> Add task</button>} />
    <div className="schedule-layout"><section className="main-card schedule-card"><div className="calendar-head"><button aria-label="Previous day" onClick={() => { const date = new Date(selected); date.setDate(date.getDate() - 1); onDate(date.toISOString().slice(0, 10)) }}><ArrowLeft /></button><h3>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(selected)}</h3><button aria-label="Next day" onClick={() => { const date = new Date(selected); date.setDate(date.getDate() + 1); onDate(date.toISOString().slice(0, 10)) }}><ChevronRight /></button></div><div className="week-strip">{dates.map((date) => { const value = date.toISOString().slice(0, 10); return <button key={value} onClick={() => onDate(value)} className={value === selectedDate ? 'active' : ''} aria-pressed={value === selectedDate}><span>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)}</span><strong>{date.getDate()}</strong>{value === new Date().toISOString().slice(0, 10) && <i />}</button> })}</div><div className="day-heading"><div><h2>{selectedDate === new Date().toISOString().slice(0, 10) ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(selected)}</h2><p>{tasks.length} care activities</p></div><span className="status-label"><i /> Live care plan</span></div><div className="schedule-timeline">{[...tasks].sort((a,b) => a.time.localeCompare(b.time)).map((task) => <button className={`schedule-item ${task.status}`} key={task.id} onClick={() => onTask(task)}><time>{task.time}</time><span className="timeline-dot" /><TaskIcon task={task} /><span><strong>{task.title}</strong><small>{task.detail}</small></span><span className="task-state">{task.status === 'done' ? <><Check size={15} /> Done</> : task.status}</span><ChevronRight /></button>)}</div></section><aside className="schedule-summary side-card"><h3>Day summary</h3><div className="summary-score"><strong>{tasks.length ? Math.round(tasks.filter((task) => task.status === 'done').length / tasks.length * 100) : 100}%</strong><span>Care plan<br />complete</span></div><div className="summary-list"><span><i className="green" />Completed <b>{tasks.filter(t => t.status === 'done').length}</b></span><span><i className="red" />Overdue <b>{tasks.filter(t => t.status === 'overdue').length}</b></span><span><i className="amber" />Remaining <b>{tasks.filter(t => t.status === 'upcoming' || t.status === 'now').length}</b></span></div></aside></div>
  </>
}

function Medications({ session, patient, medications, doses, onDose, onPrn, notify, onRefresh, locale }: { session: Session; patient: Patient; medications: Medication[]; doses: DoseLog[]; onDose: (dose: DoseLog) => void; onPrn: (medication: Medication) => void; notify: (message: string) => void; onRefresh: () => Promise<void>; locale: string }) {
  const fa = locale === 'fa'
  const t = fa ? { eyebrow: 'ایمنی دارو', title: 'داروها', description: 'نسخه‌ها، محدودیت‌های داروی در صورت نیاز، هشدارهای تداخل، موجودی، درخواست شارژ و ثبت با تأخیر.', scan: 'اسکن بارکد', newOrder: 'نسخه جدید', scheduled: 'دوزهای برنامه‌ریزی‌شده', today: 'امروز', given: 'با ایمنی ثبت شد', recorded: 'ثبت‌شده', attention: 'نیازمند توجه', refillSoon: 'نیاز به شارژ', review: 'نسخه‌های منتظر بررسی', reviewDetail: 'پیش از تأیید، حساسیت‌ها، تداخل‌ها، تاریخ‌ها، دوز، راه مصرف و دلیل تجویز را بررسی کنید.', approve: 'تأیید', reject: 'رد', doseRecord: 'ثبت دوز امروز', doseDetail: 'بیمار، دارو، دوز، راه مصرف و زمان باید تأیید شود.', none: 'امروز دوزی برنامه‌ریزی نشده است', noneDetail: 'برنامه دارویی برای این روز زمان مصرفی ندارد.' } : { eyebrow: 'MEDICATION SAFETY', title: 'Medications', description: 'Orders, PRN limits, interaction warnings, stock, refill requests, and late administration.', scan: 'Scan barcode', newOrder: 'New order', scheduled: 'Scheduled doses', today: 'today', given: 'Given safely', recorded: 'recorded', attention: 'Needs attention', refillSoon: 'refills soon', review: 'Medication orders awaiting review', reviewDetail: 'Review allergies, interactions, dates, dose, route, and indication before approval.', approve: 'Approve', reject: 'Reject', doseRecord: "Today's dose record", doseDetail: 'Patient, medicine, dose, route, and time must be confirmed.', none: 'No doses scheduled today', noneDetail: 'The medication plan has no dose times for this day.' }
  const doseCount = doses.length
  const refillCount = medications.filter((medication) => medication.stock_quantity !== null && medication.stock_quantity < 14).length
  const doseStatus = (status: DoseLog['status']) => fa ? ({ SCHEDULED: 'برنامه‌ریزی‌شده', GIVEN: 'داده شد', MISSED: 'انجام نشد', REFUSED: 'رد شد', HELD: 'نگه‌داشته شد' }[status]) : status.toLowerCase()
  const colors = ['coral', 'teal', 'gold']
  const [action, setAction] = useState<{ kind: 'barcode' | 'refill' | 'reject' | 'stock'; medication?: Medication } | null>(null)
  const [orderEditor, setOrderEditor] = useState<Medication | 'new' | null>(null)
  const [actionValue, setActionValue] = useState('')
  const [actionNote, setActionNote] = useState('')
  const [actionError, setActionError] = useState('')
  const closeAction = () => { setAction(null); setActionValue(''); setActionNote(''); setActionError('') }
  const reviewOrder = async (medication: Medication, decision: 'approve' | 'reject', reason = '') => { await reviewMedicationOrder(session.token, medication.id, decision, reason); await onRefresh(); notify(fa ? `نسخه دارو ${decision === 'approve' ? 'تأیید' : 'رد'} شد` : `Medication order ${decision === 'approve' ? 'approved' : 'rejected'}`) }
  const submitAction = async (event: FormEvent) => { event.preventDefault(); if (!action) return; setActionError(''); try { if (action.kind === 'barcode') { const found = await lookupMedicationBarcode(session.token, actionValue); notify(fa ? `${found.name} برای ${found.patient_name} تطبیق داده شد` : `${found.name} matched for ${found.patient_name}`) } else if (action.kind === 'refill' && action.medication) { await requestRefill(session.token, action.medication.id, Number(actionValue), actionNote); notify(fa ? 'درخواست شارژ ثبت شد' : 'Refill request recorded') } else if (action.kind === 'stock' && action.medication) { await adjustMedicationStock(session.token, action.medication.id, Number(actionValue), actionNote); await onRefresh(); notify(fa ? 'موجودی دارو تطبیق داده شد' : 'Medication stock reconciled') } else if (action.kind === 'reject' && action.medication) await reviewOrder(action.medication, 'reject', actionNote); closeAction() } catch (error) { setActionError(error instanceof Error ? error.message : fa ? 'انجام عملیات دارو ممکن نشد' : 'Medication action could not be completed') } }
  return <><PageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} action={<div className="med-actions"><button className="secondary-button" onClick={() => setAction({ kind: 'barcode' })}><Search /> {t.scan}</button>{['DOCTOR', 'ADMIN'].includes(session.user.role) && <button className="primary-button" onClick={() => setOrderEditor('new')}><Plus />{t.newOrder}</button>}</div>} /><div className="medication-summary"><div><Pill /><span><small>{t.scheduled}</small><strong>{doseCount} {t.today}</strong></span></div><div><ShieldCheck /><span><small>{t.given}</small><strong>{doses.filter((dose) => dose.status === 'GIVEN').length} {t.recorded}</strong></span></div><div><AlertCircle /><span><small>{t.attention}</small><strong>{refillCount} {t.refillSoon}</strong></span></div></div>
    {['DOCTOR', 'ADMIN'].includes(session.user.role) && medications.some((item) => item.approval_status === 'PENDING') && <section className="main-card order-review"><div className="subsection-heading"><div><h3>{t.review}</h3><p>{t.reviewDetail}</p></div></div>{medications.filter((item) => item.approval_status === 'PENDING').map((item) => <article className="audit-row" key={item.id}><Pill /><div><strong>{item.name} · {Number(item.dose)} {item.unit} · {item.route}</strong><small>{item.instructions || 'No additional instructions'}</small></div><div className="med-actions"><button className="primary-button" onClick={() => reviewOrder(item, 'approve')}>{t.approve}</button><button className="danger-button" onClick={() => setAction({ kind: 'reject', medication: item })}>{t.reject}</button></div></article>)}</section>}
    <section className="main-card dose-list" aria-labelledby="today-doses"><div className="subsection-heading"><div><h3 id="today-doses">{t.doseRecord}</h3><p>{t.doseDetail}</p></div></div>{doses.map((dose) => <button className={`dose-row ${fa ? 'rtl-dose-row' : ''}`} key={dose.id} onClick={() => onDose(dose)}><span className={`dose-status ${dose.status.toLowerCase()}`}><Pill /></span><span className="dose-medication" dir="ltr"><strong>{dose.medication_name}</strong><small>{Number(dose.dose)} {dose.unit} · {dose.route}</small></span><time dir="ltr">{new Date(dose.scheduled_at).toLocaleTimeString(fa ? 'fa-IR-u-ca-persian' : undefined, { hour: '2-digit', minute: '2-digit' })}</time><b className={`status-pill ${dose.status.toLowerCase()}`}>{doseStatus(dose.status)}</b><ChevronRight /></button>)}{!doses.length && <div className="empty-care"><CheckCircle2 /><strong>{t.none}</strong><p>{t.noneDetail}</p></div>}</section>
    <section className="cards-grid medication-cards">{medications.map((medication, index) => { const remaining = medication.stock_quantity ?? 0; const schedule = medication.is_prn ? (fa ? `در صورت نیاز برای ${medication.prn_reason}` : `PRN for ${medication.prn_reason}`) : medication.schedules.map((item) => item.time.slice(0, 5)).join(fa ? ' و ' : ' and ') || (fa ? 'طبق دستور' : 'As directed'); return <article className="med-card" key={medication.id}><div className={`medicine-visual ${colors[index % colors.length]}`}><Pill /></div><span className="eyebrow">{medication.approval_status === 'APPROVED' ? (fa ? 'داروی تأییدشده' : 'APPROVED MEDICATION') : medication.approval_status} {medication.is_prn ? 'PRN' : ''}</span><h3>{medication.name}</h3><strong>{Number(medication.dose)} {medication.unit} · {medication.route}</strong><div className="med-details"><span><Clock3 />{schedule}</span><span><ClipboardCheck />{medication.instructions || (fa ? 'دستور دارویی را دنبال کنید.' : 'Follow the medication order.')}</span>{medication.starts_on && <span>{fa ? 'نسخه' : 'Order'} {medication.starts_on}–{medication.ends_on || (fa ? 'ادامه دارد' : 'ongoing')}</span>}{medication.is_prn && medication.max_daily_doses && <span>{fa ? `حداکثر ${medication.max_daily_doses} دوز در روز` : `Maximum ${medication.max_daily_doses} doses per day`}</span>}</div>{medication.warnings.map((warning) => <div className="med-warning" key={warning.message}><TriangleAlert /> <span><strong>{warning.severity}</strong>{warning.message}<small>{warning.source}</small></span></div>)}<div className="stock-row"><span>{medication.stock_quantity === null ? (fa ? 'موجودی ثبت نمی‌شود' : 'Stock not tracked') : (fa ? `${remaining} دوز باقی‌مانده` : `${remaining} doses remaining`)}</span><div><i style={{ width: `${Math.min(100, remaining * 2.5)}%` }} /></div></div><div className="med-actions"><button className="secondary-button" onClick={() => { setAction({ kind: 'refill', medication }); setActionValue('30') }}>{fa ? 'درخواست شارژ' : 'Request refill'}</button><button className="secondary-button" onClick={() => { setAction({ kind: 'stock', medication }); setActionValue('0') }}>{fa ? 'ثبت موجودی' : 'Reconcile stock'}</button>{['DOCTOR', 'ADMIN'].includes(session.user.role) && <button className="secondary-button" onClick={() => setOrderEditor(medication)}>{fa ? 'ویرایش نسخه' : 'Edit order'}</button>}{medication.is_prn && <button className="primary-button" onClick={() => onPrn(medication)}>{fa ? 'ثبت دوز در صورت نیاز' : 'Record PRN dose'}</button>}</div></article> })}</section>{action && <Modal onClose={closeAction} locale={locale} label={fa ? 'فرایند ایمنی دارو' : 'Medication workflow'}><span className="eyebrow">{fa ? 'ایمنی دارو' : 'MEDICATION SAFETY'}</span><h2>{action.kind === 'barcode' ? (fa ? 'اسکن یا ورود بارکد' : 'Scan or enter barcode') : action.kind === 'refill' ? (fa ? `درخواست شارژ ${action.medication?.name}` : `Request ${action.medication?.name} refill`) : action.kind === 'stock' ? (fa ? `تطبیق موجودی ${action.medication?.name}` : `Reconcile ${action.medication?.name} stock`) : (fa ? `رد نسخه ${action.medication?.name}` : `Reject ${action.medication?.name} order`)}</h2><form className="task-form" onSubmit={submitAction}>{action.kind === 'barcode' && <label>{fa ? 'بارکد' : 'Barcode'}<input autoFocus required value={actionValue} onChange={(event) => setActionValue(event.target.value)} /></label>}{action.kind === 'refill' && <label>{fa ? 'تعداد درخواستی' : 'Requested quantity'}<input type="number" min="1" required value={actionValue} onChange={(event) => setActionValue(event.target.value)} /></label>}{action.kind === 'stock' && <label>{fa ? 'تغییر مقدار' : 'Quantity adjustment'}<input type="number" required value={actionValue} onChange={(event) => setActionValue(event.target.value)} /><small>{fa ? 'برای دریافت موجودی، عدد مثبت و برای اصلاح، عدد منفی وارد کنید.' : 'Positive for stock received; negative for a correction.'}</small></label>}{action.kind !== 'barcode' && <label>{action.kind === 'reject' ? (fa ? 'دلیل بالینی' : 'Clinical reason') : action.kind === 'stock' ? (fa ? 'دلیل تطبیق' : 'Reconciliation reason') : (fa ? 'یادداشت شارژ' : 'Refill note')}<textarea required={action.kind !== 'refill'} value={actionNote} onChange={(event) => setActionNote(event.target.value)} /></label>}{actionError && <div className="login-error"><AlertCircle />{actionError}</div>}<button className={action.kind === 'reject' ? 'danger-button' : 'primary-button'}>{action.kind === 'barcode' ? (fa ? 'تطبیق دارو' : 'Match medication') : action.kind === 'refill' ? (fa ? 'ارسال درخواست شارژ' : 'Send refill request') : action.kind === 'stock' ? (fa ? 'ذخیره تغییر موجودی' : 'Save stock adjustment') : (fa ? 'رد نسخه' : 'Reject order')}</button></form></Modal>}{orderEditor && <MedicationOrderModal locale={locale} medication={orderEditor} patient={patient} onClose={() => setOrderEditor(null)} onSave={async (id, payload) => { await saveMedicationOrder(session.token, id, payload); setOrderEditor(null); await onRefresh(); notify(id ? (fa ? 'تغییر دارو در انتظار تأیید است' : 'Medication change is pending approval') : (fa ? 'نسخه دارو برای تأیید ایجاد شد' : 'Medication order created for approval')) }} />}</>
}

function MedicationOrderModal({ medication, patient, onClose, onSave, locale }: { medication: Medication | 'new'; patient: Patient; onClose: () => void; onSave: (id: number | null, payload: Record<string, unknown>) => Promise<void>; locale: string }) {
  const fa = locale === 'fa'
  const current = medication === 'new' ? null : medication
  const [name, setName] = useState(current?.name || '')
  const [dose, setDose] = useState(current?.dose || '')
  const [unit, setUnit] = useState(current?.unit || 'mg')
  const [route, setRoute] = useState(current?.route || 'Oral')
  const [instructions, setInstructions] = useState(current?.instructions || '')
  const [startsOn, setStartsOn] = useState(current?.starts_on || '')
  const [endsOn, setEndsOn] = useState(current?.ends_on || '')
  const [prn, setPrn] = useState(current?.is_prn || false)
  const [prnReason, setPrnReason] = useState(current?.prn_reason || '')
  const [maxDaily, setMaxDaily] = useState(current?.max_daily_doses ? String(current.max_daily_doses) : '')
  const [timingWindow, setTimingWindow] = useState(String(current?.timing_window_minutes ?? 30))
  const [timingEscalationLevel, setTimingEscalationLevel] = useState(String(current?.timing_escalation_level ?? 1))
  const [scheduleTime, setScheduleTime] = useState(current?.schedules[0]?.time.slice(0, 5) || '09:00')
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); try { await onSave(current?.id || null, { patient: patient.id, name, dose, unit, route, instructions, starts_on: startsOn || null, ends_on: endsOn || null, is_prn: prn, prn_reason: prn ? prnReason : '', max_daily_doses: prn && maxDaily ? Number(maxDaily) : null, timing_window_minutes: Number(timingWindow), timing_escalation_level: Number(timingEscalationLevel), schedules: prn ? [] : [{ time: scheduleTime, days_of_week: [], instructions: '' }] }) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : fa ? 'نسخه دارو ذخیره نشد.' : 'Medication order could not be saved.') } }
  return <Modal onClose={onClose} locale={locale} label={fa ? 'ویرایشگر نسخه دارو' : 'Medication order editor'}><span className="eyebrow">{fa ? 'نسخه پزشک' : 'CLINICIAN ORDER'}</span><h2>{current ? (fa ? 'ویرایش نسخه دارو' : 'Edit medication order') : (fa ? 'نسخه داروی جدید' : 'New medication order')}</h2><form className="task-form" onSubmit={submit}><div className="form-row"><label>{fa ? 'دارو' : 'Medication'}<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>{fa ? 'دوز' : 'Dose'}<input type="number" step="0.01" min="0" required value={dose} onChange={(event) => setDose(event.target.value)} /></label></div><div className="form-row"><label>{fa ? 'واحد' : 'Unit'}<input required value={unit} onChange={(event) => setUnit(event.target.value)} /></label><label>{fa ? 'راه مصرف' : 'Route'}<input required value={route} onChange={(event) => setRoute(event.target.value)} /></label></div><label>{fa ? 'دستور مصرف' : 'Instructions'}<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label><div className="form-row"><label>{fa ? 'شروع از' : 'Starts on'}<input dir="ltr" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label>{fa ? 'پایان در' : 'Ends on'}<input dir="ltr" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div><fieldset className="window-fields"><legend>{fa ? 'سیاست زمان مصرف و تشدید' : 'Timing and escalation policy'}</legend><div className="form-row"><label>{fa ? 'بازه مجاز (دقیقه)' : 'Allowed window (minutes)'}<input type="number" min="0" max="720" required value={timingWindow} onChange={(event) => setTimingWindow(event.target.value)} /></label><label>{fa ? 'سطح تشدید' : 'Escalation level'}<select value={timingEscalationLevel} onChange={(event) => setTimingEscalationLevel(event.target.value)}><option value="1">{fa ? 'سطح ۱ · هشدار' : 'Level 1 · warning'}</option><option value="2">{fa ? 'سطح ۲ · حیاتی' : 'Level 2 · critical'}</option><option value="3">{fa ? 'سطح ۳ · فوری' : 'Level 3 · urgent chain'}</option></select></label></div><small>{fa ? 'مصرف خارج از این بازه به گزارش ایمنی افزوده می‌شود و زنجیره تشدید سازمان را دنبال می‌کند.' : 'An administration outside this window is added to the safety log and follows the organization escalation chain.'}</small></fieldset><label className="checkbox"><input type="checkbox" checked={prn} onChange={(event) => setPrn(event.target.checked)} /><span>{fa ? 'در صورت نیاز (PRN)' : 'As needed (PRN)'}</span></label>{prn ? <div className="form-row"><label>{fa ? 'اندیکاسیون داروی در صورت نیاز' : 'PRN indication'}<input required value={prnReason} onChange={(event) => setPrnReason(event.target.value)} /></label><label>{fa ? 'حداکثر دوز روزانه' : 'Maximum daily doses'}<input type="number" min="1" required value={maxDaily} onChange={(event) => setMaxDaily(event.target.value)} /></label></div> : <label>{fa ? 'زمان مصرف دوز' : 'Dose time'}<input dir="ltr" type="time" required value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label>}{error && <div className="login-error"><AlertCircle />{error}</div>}<button className="primary-button">{fa ? 'ذخیره برای تأیید' : 'Save for approval'}</button></form></Modal>
}

function TaskIcon({ task, large = false }: { task: CareTask; large?: boolean }) {
  const Icon = categoryIcons[task.category]
  return <span className={`task-icon ${task.category} ${large ? 'large' : ''}`}><Icon /></span>
}

function TaskRow({ task, onClick }: { task: CareTask; onClick: () => void }) {
  return <button className="task-row" onClick={onClick}><time>{task.time}</time><TaskIcon task={task} /><span><strong>{task.title}</strong><small>{task.detail}</small></span><ChevronRight /></button>
}

function Modal({ children, onClose, label = 'Care dialog', locale = 'en' }: { children: ReactNode; onClose: () => void; label?: string; locale?: string }) {
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
  const closeLabel = locale === 'fa' ? 'بستن پنجره' : 'Close dialog'
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label={closeLabel} tabIndex={-1} /><section className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}><button className="modal-close" onClick={onClose} aria-label={closeLabel}><X /></button>{children}</section></div>
}

export function TaskModal({ task, patient, onClose, onSave, onDelay, onSkip, onPhoto, locale = 'en' }: { task: CareTask; patient: Patient; onClose: () => void; onSave: (task: CareTask, payload: Record<string, unknown>, correction?: boolean) => Promise<void>; onDelay?: (task: CareTask, delayedUntil: string, reason: string) => Promise<void>; onSkip?: (task: CareTask, outcome: 'UNABLE' | 'REFUSED', note: string) => void | Promise<void>; onPhoto?: (occurrenceId: number) => void | Promise<void>; locale?: string }) {
  const fa = locale === 'fa'
  const occurrence = task.occurrence
  const isCorrection = Boolean(occurrence && !['PENDING', 'DELAYED'].includes(occurrence.status))
  const needsIdentityConfirmation = isCorrection || task.category === 'medication' || task.category === 'health' || ['HIGH', 'URGENT'].includes(occurrence?.task_detail.priority || '')
  const [outcome, setOutcome] = useState('COMPLETED')
  const [correctedStatus, setCorrectedStatus] = useState('PENDING')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [delayedUntil, setDelayedUntil] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (needsIdentityConfirmation && !identityConfirmed) { setError(fa ? `تأیید کنید که این رکورد برای ${patient.full_name} است.` : `Confirm that this record is for ${patient.full_name}.`); return }
    if (!occurrence) { setError(fa ? 'این وظیفه محلی باید پیش از ثبت نتیجه همگام‌سازی شود.' : 'This locally created task must synchronize before an outcome can be recorded.'); return }
    if (isCorrection && !reason.trim()) { setError(fa ? 'ثبت دلیل اصلاح الزامی است.' : 'A correction reason is required.'); return }
    if (!isCorrection && outcome !== 'COMPLETED' && !note.trim()) { setError(fa ? 'برای این نتیجه، یک یادداشت توضیحی ثبت کنید.' : 'Add a note explaining this outcome.'); return }
    setSaving(true); setError('')
    try {
      await onSave(task, isCorrection
        ? { corrected_status: correctedStatus, corrected_outcome: correctedStatus === 'DONE' ? outcome : '', reason, note }
        : { outcome, note, ...(photo ? { photo } : {}) }, isCorrection)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : fa ? 'نتیجه مراقبت ذخیره نشد.' : 'The care outcome could not be saved.')
    } finally { setSaving(false) }
  }
  return <Modal onClose={onClose} locale={locale} label={`${fa ? (isCorrection ? 'اصلاح' : 'ثبت') : (isCorrection ? 'Correct' : 'Record')} ${task.title}`}><div className="modal-task-head"><TaskIcon task={task} large /><span className="eyebrow">{isCorrection ? (fa ? 'اصلاح افزایشی' : 'APPEND-ONLY CORRECTION') : task.category.toUpperCase()}</span><h2>{task.title}</h2><p>{patient.full_name} · {fa ? 'زمان‌بندی‌شده' : 'scheduled'} {task.time}</p></div>{needsIdentityConfirmation && <PatientSafetyIdentity patient={patient} fa={fa} />}<div className="instruction-box"><span>{fa ? 'دستورهای مراقبت' : 'CARE INSTRUCTIONS'}</span><p>{task.instructions || (fa ? 'برنامه مراقبتی را دنبال کرده و مشاهده‌های مرتبط را ثبت کنید.' : 'Follow the care plan and record any relevant observations.')}</p>{occurrence?.task_detail.expected_outcome && <p><strong>{fa ? 'نتیجه مورد انتظار:' : 'Expected:'}</strong> {occurrence.task_detail.expected_outcome}</p>}{occurrence?.task_detail.safety_notes && <p><strong>{fa ? 'ایمنی:' : 'Safety:'}</strong> {occurrence.task_detail.safety_notes}</p>}{(occurrence?.task_detail.equipment?.length ?? 0) > 0 && <p><strong>{fa ? 'تجهیزات:' : 'Equipment:'}</strong> {occurrence?.task_detail.equipment?.join(', ')}</p>}</div>
    <form className="task-form safety-form" onSubmit={submit}>{isCorrection ? <><div className="safety-warning"><RotateCcw /><span><strong>{fa ? 'رکورد اصلی همچنان قابل مشاهده می‌ماند.' : 'The original record will remain visible.'}</strong><small>{fa ? 'این اقدام یک اصلاح به گزارش ممیزی اضافه می‌کند.' : 'This adds a correction to the audit trail.'}</small></span></div><label>{fa ? 'وضعیت اصلاح‌شده' : 'Corrected status'}<select value={correctedStatus} onChange={(event) => setCorrectedStatus(event.target.value)}><option value="PENDING">{fa ? 'بازگشایی به‌صورت در انتظار' : 'Reopen as pending'}</option><option value="DONE">{fa ? 'انجام شد' : 'Completed'}</option><option value="MISSED">{fa ? 'انجام نشد / ممکن نبود' : 'Unable / missed'}</option><option value="SKIPPED">{fa ? 'بیمار نپذیرفت' : 'Patient refused'}</option></select></label>{correctedStatus === 'DONE' && <label>{fa ? 'نتیجه اصلاح‌شده' : 'Corrected outcome'}<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="COMPLETED">{fa ? 'طبق برنامه انجام شد' : 'Completed as planned'}</option><option value="PARTIAL">{fa ? 'تا حدی انجام شد' : 'Partially completed'}</option></select></label>}<label>{fa ? 'دلیل اصلاح' : 'Reason for correction'}<input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder={fa ? 'چه چیزی نادرست ثبت شده بود؟' : 'What was recorded incorrectly?'} /></label></> : <label>{fa ? 'نتیجه مراقبت' : 'Care outcome'}<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="COMPLETED">{fa ? 'طبق برنامه انجام شد' : 'Completed as planned'}</option><option value="PARTIAL">{fa ? 'تا حدی انجام شد' : 'Partially completed'}</option><option value="UNABLE">{fa ? 'امکان انجام نبود' : 'Unable to complete'}</option><option value="REFUSED">{fa ? 'بیمار نپذیرفت' : 'Patient refused'}</option></select></label>}
      <label>{isCorrection ? (fa ? 'یادداشت تکمیلی' : 'Additional note') : `${fa ? 'یادداشت مراقبت' : 'Care note'}${occurrence?.task_detail.requires_note ? (fa ? ' (الزامی)' : ' (required)') : ''}`}<textarea value={note} onChange={(event) => setNote(event.target.value)} required={occurrence?.task_detail.requires_note} placeholder={fa ? 'مشاهده‌ها، اندازه‌گیری‌ها یا پیگیری لازم' : 'Observations, measurements, or follow-up needed'} /></label>{!isCorrection && <label>{fa ? 'عکس تکمیل کار' : 'Completion photo'} {occurrence?.task_detail.requires_photo ? (fa ? '(الزامی)' : '(required)') : (fa ? '(اختیاری)' : '(optional)')}<input type="file" accept="image/jpeg,image/png" required={occurrence?.task_detail.requires_photo} onChange={(event) => setPhoto(event.target.files?.[0] || null)} /></label>}{needsIdentityConfirmation && <label className="verification-check"><input type="checkbox" checked={identityConfirmed} onChange={(event) => setIdentityConfirmed(event.target.checked)} /><span>{fa ? <>تأیید می‌کنم این رکورد مراقبت برای <strong>{patient.full_name}</strong> است.</> : <>I confirmed this care record is for <strong>{patient.full_name}</strong>.</>}</span></label>}{error && <div className="login-error"><AlertCircle />{error}</div>}<button className={isCorrection ? 'primary-button' : 'complete-button'} disabled={saving}><Save />{saving ? (fa ? 'در حال ذخیره…' : 'Saving…') : isCorrection ? (fa ? 'افزودن اصلاح' : 'Add correction') : (fa ? 'ثبت نتیجه' : 'Record outcome')}</button>
    </form>{!isCorrection && occurrence && <details className="audit-preview"><summary>{fa ? 'تأخیر یا رد کردن این نوبت' : 'Delay or skip this occurrence'}</summary><div className="task-form"><label>{fa ? 'زمان جدید سررسید' : 'New due time'}<input dir="ltr" type="datetime-local" value={delayedUntil} onChange={(event) => setDelayedUntil(event.target.value)} /></label><label>{fa ? 'دلیل' : 'Reason'}<input value={delayReason} onChange={(event) => setDelayReason(event.target.value)} placeholder={fa ? 'برای گزارش ممیزی الزامی است' : 'Required for the audit trail'} /></label><button type="button" className="secondary-button" disabled={!delayedUntil || !delayReason.trim()} onClick={() => onDelay?.(task, new Date(delayedUntil).toISOString(), delayReason)}>{fa ? 'به‌تعویق انداختن وظیفه' : 'Delay task'}</button><div className="form-row"><button type="button" className="danger-button" disabled={!delayReason.trim()} onClick={() => onSkip?.(task, 'UNABLE', delayReason)}>{fa ? 'رد کردن · عدم امکان انجام' : 'Skip · unable'}</button><button type="button" className="secondary-button" disabled={!delayReason.trim()} onClick={() => onSkip?.(task, 'REFUSED', delayReason)}>{fa ? 'بیمار نپذیرفت' : 'Patient refused'}</button></div></div></details>}{occurrence && (occurrence.completion || occurrence.corrections.length > 0) && <div className="audit-preview"><h3>{fa ? 'تاریخچه رکورد' : 'Record history'}</h3>{occurrence.completion && <div className="history-row"><span><CheckCircle2 />{fa ? 'رکورد اصلی:' : 'Original:'} {occurrence.completion.outcome.toLowerCase()}</span><b>{occurrence.completion.completed_by_name}</b>{occurrence.completion.photo && <button className="text-button" onClick={() => onPhoto?.(occurrence.id)}>{fa ? 'باز کردن عکس ممیزی‌شده' : 'Open audited photo'}</button>}</div>}{occurrence.corrections.map((item) => <div className="history-row" key={item.id}><span><RotateCcw />{item.corrected_status.toLowerCase()}</span><b>{item.reason}</b></div>)}</div>}</Modal>
}

export function DoseModal({ dose, patient, onClose, onSave, locale = 'en' }: { dose: DoseLog; patient: Patient; onClose: () => void; onSave: (dose: DoseLog, payload: Record<string, unknown>, action: 'administer' | 'outcome' | 'correct') => Promise<void>; locale?: string }) {
  const fa = locale === 'fa'
  const correction = dose.status !== 'SCHEDULED'
  const [status, setStatus] = useState(correction ? 'SCHEDULED' : 'GIVEN')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [administeredAt, setAdministeredAt] = useState(() => toDateTimeLocal(new Date()))
  const [timingAcknowledged, setTimingAcknowledged] = useState(false)
  const [checks, setChecks] = useState({ patient: false, medication: false, dose: false, route: false, time: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setCheck = (key: keyof typeof checks, value: boolean) => setChecks((current) => ({ ...current, [key]: value }))
  const actualAdministration = new Date(administeredAt)
  const timingVariance = Math.trunc((actualAdministration.getTime() - new Date(dose.scheduled_at).getTime()) / 60000)
  const timingWindow = dose.timing_window_minutes ?? 30
  const timingState = timingVariance < -timingWindow ? 'EARLY' : timingVariance > timingWindow ? 'LATE' : 'ON_TIME'
  const needsTimingExplanation = !correction && status === 'GIVEN' && timingState !== 'ON_TIME'
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (correction && !reason.trim()) { setError(fa ? 'ثبت دلیل اصلاح الزامی است.' : 'A correction reason is required.'); return }
    if (!correction && status === 'GIVEN' && Object.values(checks).some((value) => !value)) { setError(fa ? 'هر پنج بررسی دارو را تأیید کنید.' : 'Confirm all five medication checks.'); return }
    if (needsTimingExplanation && (!reason.trim() || !timingAcknowledged)) { setError(fa ? 'برای ثبت دوز زودتر یا دیرتر، دلیل و تأیید شما لازم است.' : 'A reason and acknowledgement are required for an early or late dose.'); return }
    if (!correction && status !== 'GIVEN' && !reason.trim()) { setError(fa ? 'توضیح دهید چرا این دوز داده نشد.' : 'Explain why this dose was not given.'); return }
    setSaving(true)
    try {
      if (correction) await onSave(dose, { corrected_status: status, reason, note }, 'correct')
      else if (status === 'GIVEN') await onSave(dose, { note, administered_at: actualAdministration.toISOString(), timing_reason: needsTimingExplanation ? reason : '', timing_acknowledged: needsTimingExplanation ? timingAcknowledged : false, verified_patient: checks.patient, verified_medication: checks.medication, verified_dose: checks.dose, verified_route: checks.route, verified_time: checks.time }, 'administer')
      else await onSave(dose, { status, reason }, 'outcome')
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : fa ? 'رکورد دوز ذخیره نشد.' : 'The dose record could not be saved.') }
    finally { setSaving(false) }
  }
  return <Modal onClose={onClose} locale={locale} label={fa ? 'ثبت یا اصلاح دوز دارو' : `${correction ? 'Correct' : 'Verify'} medication dose`}><div className="dose-hero"><span className="task-icon medication large"><Pill /></span><span className="eyebrow">{correction ? (fa ? 'اصلاح دوز' : 'DOSE CORRECTION') : (fa ? 'بررسی پنج‌گانه' : 'FIVE-RIGHT CHECK')}</span><h2>{dose.medication_name}</h2><p>{Number(dose.dose)} {dose.unit} · {dose.route} · {new Date(dose.scheduled_at).toLocaleTimeString(fa ? 'fa-IR-u-ca-persian' : undefined, { hour: '2-digit', minute: '2-digit' })}</p></div><PatientSafetyIdentity patient={patient} fa={fa} /><form className="task-form safety-form" onSubmit={submit}><label>{correction ? (fa ? 'وضعیت اصلاح‌شده' : 'Corrected status') : (fa ? 'نتیجه دوز' : 'Dose outcome')}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="GIVEN">{fa ? 'داده شد' : 'Given'}</option><option value="SCHEDULED">{fa ? 'بازگشایی به‌صورت برنامه‌ریزی‌شده' : 'Reopen as scheduled'}</option><option value="HELD">{fa ? 'نگه‌داشته شد' : 'Held'}</option><option value="REFUSED">{fa ? 'بیمار نپذیرفت' : 'Patient refused'}</option><option value="MISSED">{fa ? 'انجام نشد' : 'Missed'}</option></select></label>{!correction && status === 'GIVEN' && <><label>{fa ? 'زمان واقعی مصرف' : 'Actual administration time'}<input dir="ltr" type="datetime-local" value={administeredAt} onChange={(event) => setAdministeredAt(event.target.value)} required /></label>{needsTimingExplanation && <div className={`timing-exception ${timingState.toLowerCase()}`} role="status"><AlertCircle /><div><strong>{timingState === 'EARLY' ? (fa ? `${Math.abs(timingVariance)} دقیقه زودتر از برنامه` : `${Math.abs(timingVariance)} minutes early`) : (fa ? `${timingVariance} دقیقه دیرتر از برنامه` : `${timingVariance} minutes late`)}</strong><small>{fa ? `زمان برنامه‌ریزی‌شده تغییر نمی‌کند. این دوز خارج از بازه ${timingWindow} دقیقه‌ای ثبت و برای بررسی ایمنی ارسال می‌شود.` : `The scheduled time will not change. This dose is outside its ${timingWindow}-minute window and will be sent for safety review.`}</small></div></div>}<fieldset className="verification-list"><legend>{fa ? 'پیش از مصرف تأیید کنید' : 'Confirm before administration'}</legend><Verification checked={checks.patient} onChange={(value) => setCheck('patient', value)} title={fa ? 'بیمار درست' : 'Right patient'} detail={patient.full_name} /><Verification checked={checks.medication} onChange={(value) => setCheck('medication', value)} title={fa ? 'داروی درست' : 'Right medication'} detail={dose.medication_name} /><Verification checked={checks.dose} onChange={(value) => setCheck('dose', value)} title={fa ? 'دوز درست' : 'Right dose'} detail={`${Number(dose.dose)} ${dose.unit}`} /><Verification checked={checks.route} onChange={(value) => setCheck('route', value)} title={fa ? 'راه مصرف درست' : 'Right route'} detail={dose.route} /><Verification checked={checks.time} onChange={(value) => setCheck('time', value)} title={fa ? 'زمان درست' : 'Right time'} detail={new Date(dose.scheduled_at).toLocaleString(fa ? 'fa-IR-u-ca-persian' : undefined)} /></fieldset></>}{(correction || status !== 'GIVEN' || needsTimingExplanation) && <label>{correction ? (fa ? 'دلیل اصلاح' : 'Reason for correction') : needsTimingExplanation ? (fa ? 'دلیل مصرف خارج از زمان' : 'Reason for administration outside the time window') : (fa ? 'دلیل' : 'Reason')}<input value={reason} onChange={(event) => setReason(event.target.value)} required={correction || status !== 'GIVEN'} placeholder={fa ? 'برای بررسی ایمنی لازم است' : 'Required for safety review'} /></label>}{needsTimingExplanation && <label className="verification-check timing-acknowledgement"><input type="checkbox" checked={timingAcknowledged} onChange={(event) => setTimingAcknowledged(event.target.checked)} /><span>{fa ? `تأیید می‌کنم دوز خارج از بازه ${timingWindow} دقیقه‌ای ثبت می‌شود و زمان برنامه‌ریزی‌شده تغییر نخواهد کرد.` : `I confirm this dose is being recorded outside the ${timingWindow}-minute window and the scheduled time will remain unchanged.`}</span></label>}<label>{fa ? 'یادداشت بالینی' : 'Clinical note'}<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={fa ? 'مشاهده یا پیگیری اختیاری' : 'Optional observation or follow-up'} /></label>{error && <div className="login-error"><AlertCircle />{error}</div>}<button className="primary-button" disabled={saving}><ShieldCheck />{saving ? (fa ? 'در حال ذخیره…' : 'Saving…') : correction ? (fa ? 'افزودن اصلاح دوز' : 'Add dose correction') : (fa ? 'ثبت نتیجه دوز' : 'Record dose outcome')}</button></form>{dose.corrections.length > 0 && <div className="audit-preview"><h3>{fa ? 'اصلاح‌های قبلی' : 'Previous corrections'}</h3>{dose.corrections.map((item) => <div className="history-row" key={item.id}><span><RotateCcw />{item.previous_status} → {item.corrected_status}</span><b>{item.reason}</b></div>)}</div>}</Modal>
}

function toDateTimeLocal(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function PrnModal({ medication, patient, onClose, onSave, locale = 'en' }: { medication: Medication; patient: Patient; onClose: () => void; onSave: (medication: Medication, payload: Record<string, unknown>) => Promise<void>; locale?: string }) {
  const fa = locale === 'fa'
  const [note, setNote] = useState('')
  const [administeredAt, setAdministeredAt] = useState(() => toDateTimeLocal(new Date()))
  const [checks, setChecks] = useState({ patient: false, medication: false, dose: false, route: false, time: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setCheck = (key: keyof typeof checks, value: boolean) => setChecks((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!note.trim()) { setError(fa ? 'دلیل و ارزیابی این دوز در صورت نیاز را ثبت کنید.' : 'Record the reason and assessment for this as-needed dose.'); return }
    if (Object.values(checks).some((value) => !value)) { setError(fa ? 'هر پنج بررسی دارو را تأیید کنید.' : 'Confirm all five medication checks.'); return }
    setSaving(true); setError('')
    try {
      await onSave(medication, {
        note,
        administered_at: new Date(administeredAt).toISOString(),
        verified_patient: checks.patient,
        verified_medication: checks.medication,
        verified_dose: checks.dose,
        verified_route: checks.route,
        verified_time: checks.time,
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : fa ? 'ثبت دوز در صورت نیاز ممکن نشد.' : 'The PRN dose could not be recorded.')
    } finally { setSaving(false) }
  }
  return <Modal onClose={onClose} locale={locale} label={fa ? `بررسی دوز در صورت نیاز برای ${medication.name}` : `Verify PRN dose for ${medication.name}`}><div className="dose-hero"><span className="task-icon medication large"><Pill /></span><span className="eyebrow">{fa ? 'داروی در صورت نیاز · بررسی پنج‌گانه' : 'PRN · FIVE-RIGHT CHECK'}</span><h2>{medication.name}</h2><p>{Number(medication.dose)} {medication.unit} · {medication.route}</p></div><PatientSafetyIdentity patient={patient} fa={fa} /><form className="task-form safety-form" onSubmit={submit}><label>{fa ? 'زمان واقعی مصرف' : 'Actual administration time'}<input dir="ltr" type="datetime-local" value={administeredAt} onChange={(event) => setAdministeredAt(event.target.value)} required /></label><p className="form-helper">{fa ? 'داروی در صورت نیاز زمان برنامه‌ریزی‌شده ندارد؛ این زمان واقعی در سابقه دارو ثبت می‌شود.' : 'PRN medication has no scheduled time. This actual time is recorded in the medication history.'}</p><label>{fa ? 'دلیل و ارزیابی' : 'Reason and assessment'}<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={medication.prn_reason || (fa ? 'نشانه‌ها، ارزیابی و دلیل نیاز به این دوز' : 'Symptoms, assessment, and reason this dose is needed')} required /></label><fieldset className="verification-list"><legend>{fa ? 'پیش از مصرف تأیید کنید' : 'Confirm before administration'}</legend><Verification checked={checks.patient} onChange={(value) => setCheck('patient', value)} title={fa ? 'بیمار درست' : 'Right patient'} detail={patient.full_name} /><Verification checked={checks.medication} onChange={(value) => setCheck('medication', value)} title={fa ? 'داروی درست' : 'Right medication'} detail={medication.name} /><Verification checked={checks.dose} onChange={(value) => setCheck('dose', value)} title={fa ? 'دوز درست' : 'Right dose'} detail={`${Number(medication.dose)} ${medication.unit}`} /><Verification checked={checks.route} onChange={(value) => setCheck('route', value)} title={fa ? 'راه مصرف درست' : 'Right route'} detail={medication.route} /><Verification checked={checks.time} onChange={(value) => setCheck('time', value)} title={fa ? 'زمان درست' : 'Right time'} detail={new Date(administeredAt).toLocaleString(fa ? 'fa-IR-u-ca-persian' : undefined)} /></fieldset>{error && <div className="login-error" role="alert"><AlertCircle />{error}</div>}<button className="primary-button" disabled={saving}><ShieldCheck />{saving ? (fa ? 'در حال ثبت…' : 'Recording…') : (fa ? 'ثبت مصرف داروی در صورت نیاز' : 'Record PRN administration')}</button></form></Modal>
}

function Verification({ checked, onChange, title, detail }: { checked: boolean; onChange: (value: boolean) => void; title: string; detail: string }) {
  return <label className="verification-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{title}</strong><small>{detail}</small></span></label>
}

function PatientSafetyIdentity({ patient, fa }: { patient: Patient; fa: boolean }) {
  return <div className="patient-safety-identity"><span>{patient.photo ? <img src={patient.photo} alt="" /> : <UserRound />}</span><div><small>{fa ? 'تأیید هویت بیمار' : 'PATIENT IDENTITY'}</small><strong>{patient.full_name}</strong><b>{patient.room ? `${fa ? 'اتاق' : 'Room'} ${patient.room}` : fa ? 'بیمار انتخاب‌شده' : 'Selected patient'}</b></div><ShieldCheck /></div>
}

function NotificationPanel({ notifications, onClose, onAction, locale }: { notifications: CareNotification[]; onClose: () => void; onAction: (item: CareNotification, action: 'acknowledge' | 'snooze') => Promise<void>; locale: string }) {
  const fa = locale === 'fa'
  const active = notifications.filter((item) => item.state !== 'ACKNOWLEDGED' && !(item.state === 'SNOOZED' && item.snoozed_until && new Date(item.snoozed_until) > new Date()))
  return <aside className="notification-panel" role="region" aria-label={fa ? 'هشدارهای مراقبت' : 'Care alerts'}><header><div><span className="eyebrow">{fa ? 'تشدید زنده' : 'LIVE ESCALATION'}</span><h2>{fa ? 'هشدارهای مراقبت' : 'Care alerts'}</h2></div><button className="modal-close" onClick={onClose} aria-label={fa ? 'بستن هشدارها' : 'Close alerts'}><X /></button></header>{active.map((item) => <article className={`notification-item ${item.severity.toLowerCase()}`} key={item.id}><span><TriangleAlert /></span><div><small>{item.severity} · {fa ? 'سطح' : 'LEVEL'} {item.escalation_level}</small><h3>{item.title}</h3><p>{item.message}</p><div><button className="primary-button" onClick={() => onAction(item, 'acknowledge')}>{fa ? 'تأیید دریافت' : 'Acknowledge'}</button><button className="secondary-button" onClick={() => onAction(item, 'snooze')}>{fa ? 'تعویق ۱۵ دقیقه' : 'Snooze 15 min'}</button></div></div></article>)}{!active.length && <div className="empty-care"><CheckCircle2 /><strong>{fa ? 'هشدار فعالی نیست' : 'No active alerts'}</strong><p>{fa ? 'وظایف و دوزهای داروی سررسید گذشته اینجا نمایش داده می‌شوند.' : 'Overdue tasks and medication doses will appear here.'}</p></div>}</aside>
}

function SafetyLog({ events, mutations, onResolve, onRefresh, locale }: { events: AuditEvent[]; mutations: QueuedMutation[]; onResolve: (item: QueuedMutation, action: 'retry' | 'discard') => Promise<void>; onRefresh: () => Promise<void>; locale: string }) {
  const fa = locale === 'fa'
  const t = fa ? { eyebrow: 'مراقبت قابل ردیابی', title: 'گزارش ایمنی و همگام‌سازی', description: 'اصلاح‌ها، اقدام‌ها و رکوردهای آفلاینی که نیاز به توجه دارند را بررسی کنید.', refresh: 'به‌روزرسانی', print: 'چاپ گزارش', offline: 'همگام‌سازی آفلاین', allSynced: 'همه تغییرات بالینی همگام هستند', audit: 'ردیابی حسابرسی افزایشی', auditDetail: 'نتیجه اصلی پس از اصلاح قابل مشاهده باقی می‌ماند.', everything: 'همه‌چیز همگام است', noAudit: 'اقدامی برای این فیلتر وجود ندارد', all: 'همه', today: 'امروز', medication: 'داروها', corrections: 'اصلاح‌ها', conflicts: 'تعارض‌های آفلاین' } : { eyebrow: 'TRACEABLE CARE', title: 'Safety & sync log', description: 'Review corrections, actions, and offline records that need attention.', refresh: 'Refresh', print: 'Print report', offline: 'Offline synchronization', allSynced: 'All clinical changes are synchronized', audit: 'Append-only audit trail', auditDetail: 'Original outcomes remain visible after a correction.', everything: 'Everything is synchronized', noAudit: 'No actions match this filter', all: 'All', today: 'Today', medication: 'Medications', corrections: 'Corrections', conflicts: 'Offline conflicts' }
  const [filter, setFilter] = useState<'all' | 'today' | 'medication' | 'correction' | 'conflict'>('all')
  const today = new Date().toDateString()
  const filteredEvents = events.filter((event) => filter === 'all' || (filter === 'today' && new Date(event.created_at).toDateString() === today) || (filter === 'medication' && /(MEDICATION|DOSE)/.test(event.action)) || (filter === 'correction' && /CORRECT/.test(event.action)))
  const filteredMutations = mutations.filter((item) => filter === 'all' || filter === 'conflict' ? (filter !== 'conflict' || item.status === 'conflict') : filter === 'today' ? new Date(item.createdAt).toDateString() === today : filter === 'medication' ? /medication|dose/i.test(item.path) : /correct/i.test(item.path))
  const filters = [['all', t.all], ['today', t.today], ['medication', t.medication], ['correction', t.corrections], ['conflict', t.conflicts]] as const
  return <><PageHeader eyebrow={t.eyebrow} title={t.title} description={t.description} action={<div className="med-actions"><button className="secondary-button" onClick={() => window.print()}>{t.print}</button><button className="secondary-button" onClick={onRefresh}><RefreshCw /> {t.refresh}</button></div>} /><div className="audit-filters" role="group" aria-label={fa ? 'فیلتر گزارش ایمنی' : 'Safety log filters'}>{filters.map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="safety-grid"><section className="main-card sync-review"><div className="subsection-heading"><div><h3>{t.offline}</h3><p>{filteredMutations.length ? (fa ? `${filteredMutations.length} تغییر نیازمند بررسی است` : `${filteredMutations.length} change${filteredMutations.length === 1 ? '' : 's'} need review`) : t.allSynced}</p></div></div>{filteredMutations.map((item) => <article className={`sync-item ${item.status || 'pending'}`} key={item.id}><span>{item.status === 'conflict' ? <TriangleAlert /> : item.status === 'failed' ? <AlertCircle /> : <Cloud />}</span><div><strong>{item.path.replaceAll('/', ' ').trim()}</strong><small>{new Date(item.createdAt).toLocaleString(fa ? 'fa-IR-u-ca-persian' : undefined)} · {item.status || 'pending'} · {item.attempts} {fa ? 'تلاش' : 'retries'}</small>{item.lastError && <p>{item.lastError}</p>}{item.status === 'conflict' && <details className="conflict-compare"><summary>{fa ? 'مقایسه رکورد در صف و سرور' : 'Compare queued and server records'}</summary><div><span><b>{fa ? 'تغییر در صف' : 'Queued change'}</b><code>{JSON.stringify(item.body, null, 2)}</code></span><span><b>{fa ? 'رکورد فعلی سرور' : 'Current server record'}</b><code>{JSON.stringify(item.serverState, null, 2)}</code></span></div></details>}</div><div><button className="secondary-button" onClick={() => onResolve(item, 'retry')}><RotateCcw /> {fa ? 'تلاش با نسخه فعلی' : 'Retry with current version'}</button><button className="text-button danger-text" onClick={() => onResolve(item, 'discard')}>{fa ? 'حذف' : 'Discard'}</button></div></article>)}{!filteredMutations.length && <div className="empty-care compact"><Cloud /><strong>{t.everything}</strong></div>}</section><section className="main-card audit-log"><div className="subsection-heading"><div><h3>{t.audit}</h3><p>{t.auditDetail}</p></div></div>{filteredEvents.map((event) => <article className="audit-row" key={event.id}><span><History /></span><div><strong>{event.summary}</strong><small>{event.actor_name || (fa ? 'سامانه' : 'System')} · {new Date(event.created_at).toLocaleString(fa ? 'fa-IR-u-ca-persian' : undefined)}</small></div><b>{event.action.replaceAll('_', ' ').toLowerCase()}</b></article>)}{!filteredEvents.length && <div className="empty-care compact"><History /><strong>{t.noAudit}</strong></div>}</section></div></>
}

function VitalModal({ onClose, onSave, locale }: { onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void>; locale: string }) {
  const fa = locale === 'fa'
  const [type, setType] = useState<VitalRecord['type']>('BLOOD_PRESSURE')
  const [value, setValue] = useState('120')
  const [secondary, setSecondary] = useState('80')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const units: Record<VitalRecord['type'], string> = { BLOOD_PRESSURE: 'mmHg', HEART_RATE: 'bpm', OXYGEN: '%', TEMPERATURE: '°C', WEIGHT: 'kg', GLUCOSE: 'mg/dL' }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ type, value, secondary_value: type === 'BLOOD_PRESSURE' ? secondary : null, unit: units[type] })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : fa ? 'اندازه‌گیری ذخیره نشد.' : 'Reading could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  return <Modal onClose={onClose} locale={locale} label={fa ? 'ثبت علائم حیاتی' : 'Record a vital'}><span className="eyebrow">{fa ? 'ثبت جدید سلامت' : 'NEW HEALTH READING'}</span><h2>{fa ? 'ثبت علائم حیاتی' : 'Record a vital'}</h2><p className="modal-intro">{fa ? 'این اندازه‌گیری با زمان و حساب کاربری شما ثبت می‌شود.' : 'The reading is timestamped and attributed to your account.'}</p><form className="task-form" onSubmit={submit}><label>{fa ? 'نوع اندازه‌گیری' : 'Vital type'}<select value={type} onChange={(event) => setType(event.target.value as VitalRecord['type'])}><option value="BLOOD_PRESSURE">{fa ? 'فشار خون' : 'Blood pressure'}</option><option value="HEART_RATE">{fa ? 'ضربان قلب' : 'Heart rate'}</option><option value="OXYGEN">{fa ? 'اشباع اکسیژن' : 'Oxygen saturation'}</option><option value="TEMPERATURE">{fa ? 'دما' : 'Temperature'}</option><option value="WEIGHT">{fa ? 'وزن' : 'Weight'}</option><option value="GLUCOSE">{fa ? 'قند خون' : 'Blood glucose'}</option></select></label><div className="form-row"><label>{type === 'BLOOD_PRESSURE' ? (fa ? 'سیستولیک' : 'Systolic') : (fa ? 'مقدار' : 'Value')}<input type="number" step="0.1" min="0" required value={value} onChange={(event) => setValue(event.target.value)} /></label>{type === 'BLOOD_PRESSURE' && <label>{fa ? 'دیاستولیک' : 'Diastolic'}<input type="number" step="1" min="0" required value={secondary} onChange={(event) => setSecondary(event.target.value)} /></label>}</div><p className="form-unit">{fa ? 'واحد' : 'Unit'}: {units[type]}</p>{error && <div className="login-error"><AlertCircle />{error}</div>}<button className="primary-button" disabled={saving}>{saving ? (fa ? 'در حال ذخیره…' : 'Saving…') : (fa ? 'ذخیره اندازه‌گیری' : 'Save reading')}</button></form></Modal>
}

type ScheduleProps = { session: Session; patient: Patient; tasks: CareTask[]; locale: string; selectedDate: string; onDate: (date: string) => Promise<void>; onTask: (task: CareTask) => void; onAdd: () => void }

function Schedule(props: ScheduleProps) {
  return <UnifiedSchedule {...props} onRecordOccurrence={(occurrence) => props.onTask(mapOccurrenceTask(occurrence, props.locale))} />
}

export function CalendarCoverage({ session, patient, selectedDate, locale, mode, onDate, onTask }: Pick<ScheduleProps, 'session' | 'patient' | 'selectedDate' | 'locale' | 'onDate' | 'onTask'> & { mode: 'week' | 'month' }) {
  const [data, setData] = useState<CalendarData | null>(null)
  const [error, setError] = useState('')
  const selected = new Date(`${selectedDate}T12:00:00`)
  const range = (() => {
    if (mode === 'week') {
      const start = new Date(selected); start.setDate(start.getDate() - ((start.getDay() - (locale === 'fa' ? 6 : 1) + 7) % 7))
      const end = new Date(start); end.setDate(end.getDate() + 7)
      return [start, end] as const
    }
    const start = new Date(selected.getFullYear(), selected.getMonth(), 1)
    start.setDate(start.getDate() - ((start.getDay() - (locale === 'fa' ? 6 : 1) + 7) % 7))
    const end = new Date(start); end.setDate(end.getDate() + 42)
    return [start, end] as const
  })()
  const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const rangeStart = key(range[0])
  const rangeEnd = key(range[1])
  useEffect(() => { let cancelled = false; setError(''); getCalendar(session.token, patient.id, rangeStart, rangeEnd).then((next) => !cancelled && setData(next)).catch(() => !cancelled && setError(locale === 'fa' ? 'بارگذاری تقویم ممکن نشد.' : 'Calendar data could not be loaded.')); return () => { cancelled = true } }, [session.token, patient.id, locale, rangeStart, rangeEnd])
  const selectOccurrence = (occurrence: TaskOccurrence) => {
    const scheduled = new Date(occurrence.effective_scheduled_at)
    const task: CareTask = { id: occurrence.id, taskId: occurrence.task, time: scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), title: occurrence.task_detail.title, detail: occurrence.task_detail.assigned_to_name || occurrence.task_detail.patient_name, category: categoryFromApi[occurrence.task_detail.category] || 'care', status: occurrence.status === 'DONE' ? 'done' : occurrence.status === 'MISSED' ? 'overdue' : 'upcoming', instructions: occurrence.task_detail.instructions, occurrence }
    onDate(key(scheduled)).then(() => onTask(task)).catch(() => onTask(task))
  }
  return <>{error && <div className="workspace-notice"><AlertCircle />{error}</div>}{mode === 'month' ? <MonthCalendar selectedDate={selectedDate} onDate={onDate} locale={locale} data={data} onOccurrence={selectOccurrence} /> : <WeekCalendar selectedDate={selectedDate} onDate={onDate} locale={locale} data={data} onOccurrence={selectOccurrence} />}</>
}

function MonthCalendar({ selectedDate, onDate, locale, data, onOccurrence }: Pick<ScheduleProps, 'selectedDate' | 'onDate' | 'locale'> & { data: CalendarData | null; onOccurrence: (occurrence: TaskOccurrence) => void }) {
  const fa = locale === 'fa'
  const [month, setMonth] = useState(() => new Date(`${selectedDate}T12:00:00`))
  const startOfMonth = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (startOfMonth.getDay() - (fa ? 6 : 1) + 7) % 7
  const cells = Array.from({ length: Math.ceil((offset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1))
  const formatter = new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : 'en', { month: 'long', year: 'numeric' })
  const dayFormatter = new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : 'en', { weekday: 'short' })
  const selected = new Date(`${selectedDate}T12:00:00`)
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const toKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const weekdays = Array.from({ length: 7 }, (_, index) => dayFormatter.format(new Date(2026, 5, (fa ? 6 : 1) + index)))
  const dayItems = (day: Date) => data?.occurrences.filter((item) => sameDay(new Date(item.effective_scheduled_at), day)) || []
  const dayShifts = (day: Date) => data?.shifts.filter((item) => new Date(item.starts_at) <= new Date(`${toKey(day)}T23:59:59`) && new Date(item.ends_at) >= new Date(`${toKey(day)}T00:00:00`)) || []
  return <section className="main-card month-calendar"><div className="calendar-head"><button aria-label={fa ? 'ماه قبل' : 'Previous month'} onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ArrowLeft /></button><h2>{formatter.format(month)}</h2><button aria-label={fa ? 'ماه بعد' : 'Next month'} onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight /></button></div><div className="calendar-coverage-key"><span><i className="event-dot" />{fa ? 'فعالیت برنامه‌ریزی‌شده' : 'Scheduled care'}</span><span><i className="coverage-dot" />{fa ? 'پوشش شیفت' : 'Shift coverage'}</span></div><div className="month-weekdays">{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="month-grid">{cells.map((day) => { const items = dayItems(day); const shifts = dayShifts(day); return <button key={toKey(day)} className={`${day.getMonth() === month.getMonth() ? '' : 'outside'} ${sameDay(day, selected) ? 'active' : ''} ${sameDay(day, new Date()) ? 'today' : ''}`} onClick={() => onDate(toKey(day))}><span>{new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : 'en', { day: 'numeric' }).format(day)}</span><small>{items.length ? (fa ? `${items.length} فعالیت` : `${items.length} care`) : ''}</small><div className="month-event-dots" aria-label={fa ? `${items.length} فعالیت و ${shifts.length} شیفت` : `${items.length} care events and ${shifts.length} shifts`}>{items.slice(0, 3).map((item) => <i key={item.id} className="event-dot" />)}{shifts.length > 0 && <i className="coverage-dot" />}</div>{items.slice(0, 2).map((item) => <span className="month-event-label" onClick={(event) => { event.stopPropagation(); onOccurrence(item) }} key={`item-${item.id}`}>{item.task_detail.title}</span>)}</button> })}</div></section>
}

function WeekCalendar({ selectedDate, onDate, locale, data, onOccurrence }: Pick<ScheduleProps, 'selectedDate' | 'onDate' | 'locale'> & { data: CalendarData | null; onOccurrence: (occurrence: TaskOccurrence) => void }) {
  const fa = locale === 'fa'; const selected = new Date(`${selectedDate}T12:00:00`); const weekStart = new Date(selected); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() - (fa ? 6 : 1) + 7) % 7))
  const days = Array.from({ length: 7 }, (_, index) => { const day = new Date(weekStart); day.setDate(day.getDate() + index); return day })
  const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const dayEvents = (day: Date) => data?.occurrences.filter((item) => new Date(item.effective_scheduled_at).toDateString() === day.toDateString()) || []
  const dayShifts = (day: Date) => data?.shifts.filter((item) => new Date(item.starts_at) <= new Date(`${dateKey(day)}T23:59:59`) && new Date(item.ends_at) >= new Date(`${dateKey(day)}T00:00:00`)) || []
  return <section className="main-card week-calendar"><div className="calendar-head"><h2>{fa ? 'برنامه هفتگی با ساعت' : 'Hourly weekly schedule'}</h2><span>{new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : 'en', { month: 'long', year: 'numeric' }).format(selected)}</span></div><div className="week-hour-grid"><div className="week-time-head" />{days.map((day) => <button className={dateKey(day) === selectedDate ? 'active' : ''} key={dateKey(day)} onClick={() => onDate(dateKey(day))}><strong>{new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : 'en', { weekday: 'short' }).format(day)}</strong><small>{new Intl.DateTimeFormat(fa ? 'fa-IR-u-ca-persian' : 'en', { day: 'numeric' }).format(day)}</small></button>)}{Array.from({ length: 14 }, (_, offset) => { const hour = offset + 6; return <><span className="hour-label" key={`hour-${hour}`}>{`${String(hour).padStart(2, '0')}:00`}</span>{days.map((day) => <div className="hour-cell" key={`${dateKey(day)}-${hour}`}>{dayEvents(day).filter((item) => new Date(item.effective_scheduled_at).getHours() === hour).map((item) => <button className="hour-event" key={item.id} onClick={() => onOccurrence(item)}>{new Date(item.effective_scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {item.task_detail.title}</button>)}{hour === 6 && dayShifts(day).map((shift) => <span className="coverage-overlay" key={shift.id} title={`${shift.caregiver_name} · ${shift.status}`}>{fa ? `شیفت ${shift.caregiver_name}` : `Shift: ${shift.caregiver_name}`}</span>)}</div>)}</> })}</div><div className="coverage-list"><strong>{fa ? 'پوشش و دسترسی' : 'Coverage & availability'}</strong>{data?.availability.length ? data.availability.map((item) => <span key={item.id} className={item.available ? 'available' : 'unavailable'}>{item.available ? (fa ? 'در دسترس' : 'Available') : (fa ? 'در دسترس نیست' : 'Unavailable')} · {item.caregiver_name} · {new Date(item.starts_at).toLocaleString(fa ? 'fa-IR-u-ca-persian' : undefined)}</span>) : <span>{fa ? 'محدوده دسترسی ثبت نشده است.' : 'No availability windows recorded.'}</span>}</div></section>
}

export function PersianSchedule({ tasks, selectedDate, onDate, onTask, onAdd }: Omit<ScheduleProps, 'locale'>) {
  const selected = new Date(`${selectedDate}T12:00:00`)
  const today = new Date()
  const calendarLocale = 'fa-IR-u-ca-persian'
  const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const selectedKey = dateKey(selected)
  const todayKey = dateKey(today)
  const dates = Array.from({ length: 7 }, (_, index) => { const value = new Date(selected); value.setDate(value.getDate() + index - 3); return value })
  const label = (value: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(calendarLocale, options).format(value)
  const status = { done: 'انجام شده', overdue: 'گذشته', now: 'اکنون', upcoming: 'در انتظار' } as const
  const completed = tasks.filter((task) => task.status === 'done').length
  const overdue = tasks.filter((task) => task.status === 'overdue').length
  const remaining = tasks.filter((task) => task.status === 'upcoming' || task.status === 'now').length
  const moveDay = (offset: number) => { const value = new Date(selected); value.setDate(value.getDate() + offset); onDate(dateKey(value)) }

  return <>
    <PageHeader eyebrow="تقویم مراقبت" title="برنامه مراقبت" description={`برنامه مراقبت برای ${label(selected, { dateStyle: 'full' })}.`} action={<button className="primary-button" onClick={onAdd}><Plus size={19} />افزودن فعالیت</button>} />
    <div className="schedule-layout"><section className="main-card schedule-card"><div className="calendar-head"><button aria-label="روز قبل" onClick={() => moveDay(-1)}><ArrowLeft /></button><h3>{label(selected, { month: 'long', year: 'numeric' })}</h3><button aria-label="روز بعد" onClick={() => moveDay(1)}><ChevronRight /></button></div><div className="week-strip">{dates.map((date) => { const value = dateKey(date); return <button key={value} onClick={() => onDate(value)} className={value === selectedKey ? 'active' : ''} aria-pressed={value === selectedKey}><span>{label(date, { weekday: 'short' })}</span><strong>{label(date, { day: 'numeric' })}</strong>{value === todayKey && <i />}</button> })}</div><div className="day-heading"><div><h2>{selectedKey === todayKey ? 'امروز' : label(selected, { weekday: 'long', month: 'long', day: 'numeric' })}</h2><p>{tasks.length} فعالیت مراقبتی</p></div><span className="status-label"><i /> برنامه مراقبت فعال</span></div><div className="schedule-timeline">{[...tasks].sort((a, b) => a.time.localeCompare(b.time)).map((task) => <button className={`schedule-item ${task.status}`} key={task.id} onClick={() => onTask(task)}><time dir="ltr">{task.time}</time><span className="timeline-dot" /><TaskIcon task={task} /><span><strong>{task.title}</strong><small>{task.detail}</small></span><span className="task-state">{task.status === 'done' ? <><Check size={15} /> {status.done}</> : status[task.status]}</span><ChevronRight /></button>)}</div></section><aside className="schedule-summary side-card"><h3>خلاصه روز</h3><div className="summary-score"><strong>{tasks.length ? Math.round(completed / tasks.length * 100) : 100}%</strong><span>تکمیل برنامه<br />مراقبت</span></div><div className="summary-list"><span><i className="green" />انجام‌شده <b>{completed}</b></span><span><i className="red" />گذشته <b>{overdue}</b></span><span><i className="amber" />باقی‌مانده <b>{remaining}</b></span></div></aside></div>
  </>
}

export default App
