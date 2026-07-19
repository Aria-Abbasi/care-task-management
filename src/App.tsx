import { CSSProperties, FormEvent, lazy, ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, AlertCircle, ArrowLeft, Bell, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ClipboardCheck, Clock3, HeartPulse, Home,
  LogOut, Menu, MessageCircle, MoreHorizontal, Plus, Search, Settings,
  ShieldCheck, Sparkles, Stethoscope, Sun, Thermometer, UserRound,
  Weight, X, Pill, Footprints, Utensils, Send, FileText, Cloud, CloudOff, RefreshCw,
  History, RotateCcw, Save, TriangleAlert,
} from 'lucide-react'
import {
  ApiError,
  clearSession,
  confirmPasswordReset,
  flushMutationQueue,
  getAuditEvents,
  getSignedAuditExport,
  getPatientDashboard,
  getPatients,
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
} from './lib/api'
import {
  cacheDashboard, cachePatients, clearOfflineData, listMutations, pendingMutationCount, queuedMutationOwners,
  readCachedDashboard, readCachedPatients, removeMutation, retryMutation, type QueuedMutation,
} from './lib/offline'
import type {
  ApiUser, AuditEvent, CareNotification, DashboardResponse, DoseLog, Medication, Patient,
  Session, TaskOccurrence, VitalRecord,
} from './lib/types'

type View = 'today' | 'schedule' | 'tasks' | 'medications' | 'clinical' | 'health' | 'reports' | 'messages' | 'safety' | 'admin' | 'settings'
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
const SecuritySettingsView = lazy(() => import('./features/SettingsView'))
const ClinicalProfileView = lazy(() => import('./features/ClinicalProfileView'))
const AdminView = lazy(() => import('./features/AdminView'))
const viewIds: View[] = ['today', 'schedule', 'tasks', 'medications', 'clinical', 'health', 'reports', 'messages', 'safety', 'admin', 'settings']
const viewFromLocation = (): View => {
  const candidate = window.location.pathname.split('/').filter(Boolean).at(-1) as View | undefined
  return candidate && viewIds.includes(candidate) ? candidate : 'today'
}

const categoryToApi: Record<CareTask['category'], string> = {
  medication: 'MEDICATION',
  health: 'HEALTH',
  meal: 'MEAL',
  activity: 'ACTIVITY',
  care: 'PERSONAL_CARE',
}

function mapDashboardTasks(dashboard: DashboardResponse): CareTask[] {
  const now = Date.now()
  return dashboard.occurrences.map((occurrence) => {
    const scheduled = new Date(occurrence.effective_scheduled_at)
    const minutesFromNow = (scheduled.getTime() - now) / 60_000
    let status: TaskStatus = 'upcoming'
    if (occurrence.status === 'DONE') status = 'done'
    else if (occurrence.status === 'MISSED') status = 'overdue'
    else if (minutesFromNow < -30) status = 'overdue'
    else if (minutesFromNow <= 30) status = 'now'
    return {
      id: occurrence.id,
      taskId: occurrence.task,
      time: scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      title: occurrence.task_detail.title,
      detail: status === 'overdue' ? `${Math.max(1, Math.round(-minutesFromNow))} minutes overdue` : occurrence.task_detail.assigned_to_name || occurrence.task_detail.patient_name,
      category: categoryFromApi[occurrence.task_detail.category] || 'care',
      status,
      instructions: occurrence.task_detail.instructions,
      occurrence,
    }
  })
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

const navigation: { id: View; label: string; icon: typeof Home }[] = [
  { id: 'today', label: 'Today', icon: Home },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'tasks', label: 'Tasks', icon: ClipboardCheck },
  { id: 'medications', label: 'Medications', icon: Pill },
  { id: 'clinical', label: 'Clinical profile', icon: Stethoscope },
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
  { id: 'safety', label: 'Safety log', icon: ShieldCheck },
  { id: 'admin', label: 'Administration', icon: Settings },
  { id: 'settings', label: 'Settings', icon: Settings },
]

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
  const [patientMenu, setPatientMenu] = useState(false)
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
      setTasks(mapDashboardTasks(nextDashboard))
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
        setTasks(mapDashboardTasks(cached))
        setWorkspaceError('Showing the most recent saved care plan.')
      } else {
        setWorkspaceError(error instanceof Error ? error.message : 'Unable to load the care workspace.')
      }
    } finally {
      setLoadingWorkspace(false)
    }
  }, [selectedDate])

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr'
    localStorage.setItem('haven.locale', locale)
  }, [locale])

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

  const selectPatient = async (patientId: number) => {
    if (!session || patientId === dashboard?.patient.id) {
      setPatientMenu(false)
      return
    }
    setPatientMenu(false)
    setSelectedTask(null)
    setSelectedDose(null)
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

  const addTask = async (task: Omit<CareTask, 'id' | 'status'>) => {
    const localTask: CareTask = { ...task, id: -Date.now(), status: 'upcoming', localOnly: true }
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
          title: task.title,
          category: categoryToApi[task.category],
          instructions: task.instructions,
          schedules: [{ frequency: 'DAILY', time: task.time }],
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

  const activeLabel = navigation.find((item) => item.id === view)?.label
  const patient = dashboard.patient
  const user = session.user
  const visibleNavigation = navigation.filter((item) => {
    if (user.role === 'FAMILY') return ['today', 'health', 'reports', 'messages', 'settings'].includes(item.id)
    if (user.role === 'DOCTOR') return !['schedule', 'tasks'].includes(item.id)
    if (item.id === 'admin') return user.role === 'ADMIN'
    return true
  })

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to care workspace</a>
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="brand"><BrandMark /><span>haven</span></div>
        <button className="mobile-close" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X /></button>
        <button className="patient-mini" onClick={() => setPatientMenu(!patientMenu)} aria-expanded={patientMenu} aria-haspopup="listbox">
          <div className="avatar avatar-hassan">{initials(patient.full_name)}</div>
          <div><strong>{patient.full_name}</strong><span>{patients.length} assigned {patients.length === 1 ? 'person' : 'people'}</span></div>
          <ChevronDown size={17} />
        </button>
        {patientMenu && <div className="patient-switcher" role="listbox" aria-label="Select person receiving care">
          {patients.map((item) => <button key={item.id} role="option" aria-selected={item.id === patient.id} onClick={() => selectPatient(item.id)}>
            <span className="avatar">{initials(item.full_name)}</span><span><strong>{item.full_name}</strong><small>{item.room ? `Room ${item.room}` : `${item.age} years old`}</small></span>{item.id === patient.id && <Check />}
          </button>)}
        </div>}
        <nav>
          <span className="nav-heading">CARE WORKSPACE</span>
          {visibleNavigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => { navigate(id); setMobileMenu(false) }}>
              <Icon size={20} strokeWidth={2} /><span>{label}</span>
              {id === 'messages' && <em>2</em>}
            </button>
          ))}
        </nav>
        <div className="shift-card">
          <div><Sun size={18} /><span>Morning shift</span></div>
          <strong>07:00 — 15:00</strong>
          <small>4h 22m remaining</small>
          <div className="shift-progress"><i /></div>
        </div>
        <div className="profile-row">
          <div className="avatar avatar-sarah">{initials(user.display_name)}</div>
          <div><strong>{user.display_name}</strong><span>{user.role.toLowerCase()}</span></div>
          <MoreHorizontal size={19} />
        </div>
      </aside>

      {mobileMenu && <button className="backdrop" onClick={() => setMobileMenu(false)} aria-label="Close menu" />}

      <main id="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu /></button>
            <div><span className="mobile-page-title">{activeLabel}</span><span className="breadcrumb">{patient.first_name}'s care <ChevronRight size={13} /> {activeLabel}</span></div>
          </div>
          <div className="topbar-actions">
            <button className={`sync-status ${online ? '' : 'offline'}`} onClick={() => pendingSync ? setView('safety') : syncNow()} title={online ? `${pendingSync} pending changes` : 'Working offline'}>
              {syncing ? <RefreshCw className="spinning" /> : online ? <Cloud /> : <CloudOff />}
              <span>{syncing ? 'Syncing' : !online ? 'Offline' : pendingSync ? `${pendingSync} pending` : 'Synced'}</span>
            </button>
            <button className="icon-button search-button" aria-label="Search"><Search size={19} /></button>
            <button className="icon-button notification-button" onClick={() => { setNotificationPanel(!notificationPanel); loadNotifications().catch(() => undefined) }} aria-label={`${notifications.filter((item) => item.state === 'UNREAD').length} unread notifications`} aria-expanded={notificationPanel}><Bell size={19} />{notifications.some((item) => item.state === 'UNREAD') && <i />}</button>
            <div className="avatar avatar-sarah top-avatar">{initials(user.display_name)}</div>
          </div>
        </header>

        <div className="content">
          {workspaceError && <div className="workspace-notice"><CloudOff />{workspaceError}</div>}
          <div className="role-context" role="status"><ShieldCheck /> <strong>{user.role === 'CAREGIVER' ? 'Caregiver workspace' : user.role === 'DOCTOR' ? 'Clinical review workspace' : user.role === 'FAMILY' ? 'Family update workspace' : 'Organization administration'}</strong><span>{user.role === 'CAREGIVER' ? 'Due care and rapid recording' : user.role === 'DOCTOR' ? 'Orders, trends, and review' : user.role === 'FAMILY' ? 'Simplified updates and messaging' : 'Staffing, permissions, delivery, and audit oversight'}</span></div>
          {view === 'today' && <Dashboard tasks={tasks} patient={patient} user={user} locale={locale} vitals={dashboard.latest_vitals} onTask={setSelectedTask} onComplete={setSelectedTask} onAdd={() => setShowAddTask(true)} onNavigate={navigate} />}
          {view === 'schedule' && <Schedule tasks={tasks} locale={locale} selectedDate={selectedDate} onDate={(date) => refreshWorkspace(session, patient.id, date)} onTask={setSelectedTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'tasks' && <Tasks tasks={tasks} onTask={setSelectedTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'medications' && <Medications session={session} patient={patient} medications={dashboard.medications} doses={dashboard.dose_logs} onDose={setSelectedDose} notify={notify} onRefresh={() => refreshWorkspace(session, patient.id, selectedDate)} />}
          <Suspense fallback={<div className="main-card loading-feature"><RefreshCw className="spinning" /> Loading workspace…</div>}>
            {view === 'health' && <HealthView session={session} patient={patient} latest={dashboard.latest_vitals} onRecord={() => setShowVital(true)} />}
            {view === 'clinical' && <ClinicalProfileView session={session} patient={patient} />}
            {view === 'admin' && <AdminView session={session} notify={notify} />}
            {view === 'reports' && <ReportsView session={session} patient={patient} taskCount={tasks.filter((task) => task.status === 'done').length} vitalCount={dashboard.latest_vitals.length} onSend={sendReport} notify={notify} />}
            {view === 'messages' && <MessagesView session={session} patient={patient} notify={notify} />}
            {view === 'settings' && <SecuritySettingsView session={session} onSignOut={signOut} notify={notify} locale={locale} onLocale={setLocale} />}
          </Suspense>
          {view === 'safety' && <><button className="secondary-button audit-export-button" onClick={exportAudit}><FileText /> Export signed audit report</button><SafetyLog events={auditEvents} mutations={syncItems} onResolve={resolveSyncItem} onRefresh={loadSafetyData} /></>}
        </div>
      </main>

      <nav className="bottom-nav">
        {visibleNavigation.slice(0, 4).map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => navigate(id)}><Icon /><span>{label}</span></button>
        ))}
        <button className={!visibleNavigation.slice(0, 4).some((item) => item.id === view) ? 'active' : ''} onClick={() => setMobileMenu(true)}><Menu /><span>More</span></button>
      </nav>

      {notificationPanel && <NotificationPanel notifications={notifications} onClose={() => setNotificationPanel(false)} onAction={actOnNotification} />}
      {selectedTask && <TaskModal task={selectedTask} patient={patient} onClose={() => setSelectedTask(null)} onSave={recordTaskOutcome} />}
      {selectedDose && <DoseModal dose={selectedDose} patient={patient} onClose={() => setSelectedDose(null)} onSave={recordDoseOutcome} />}
      {showAddTask && <AddTaskModal patient={patient} onClose={() => setShowAddTask(false)} onAdd={addTask} />}
      {showVital && <VitalModal onClose={() => setShowVital(false)} onSave={recordVital} />}
      <div className="sr-only" aria-live="polite">{syncing ? 'Synchronizing care records' : pendingSync ? `${pendingSync} changes need synchronization` : 'Care records synchronized'}</div>
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
          <label>Password<div className="password-field"><input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" required /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
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
  const todayLabel = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-persian' : 'en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase()
  return (
    <>
      <section className="welcome-row">
        <div><span className="eyebrow">{todayLabel}</span><h1>Good morning, {user.first_name || user.display_name}</h1><p>Here's what {patient.first_name} needs today.</p></div>
        {canRecordCare && <button className="primary-button" onClick={onAdd}><Plus size={19} /> Add task</button>}
      </section>

      <section className="patient-hero">
        <div className="patient-identity"><div className="avatar avatar-hassan hero-avatar">{initials(patient.full_name)}<span /></div><div><span className="status-label"><i /> Stable today</span><h2>{patient.full_name}</h2><p>{patient.age} years old{patient.room ? ` · Room ${patient.room}` : ''}</p></div></div>
        <div className="hero-stats">
          <div><HeartPulse /><span><small>Blood pressure</small><strong>{bloodPressure ? `${Number(bloodPressure.value)}/${Number(bloodPressure.secondary_value)}` : '—'} <em>{bloodPressure?.unit || ''}</em></strong></span><b>{bloodPressure ? 'Recorded' : 'No reading'}</b></div>
          <div><Activity /><span><small>Oxygen</small><strong>{oxygen ? Number(oxygen.value) : '—'}<em>{oxygen?.unit || ''}</em></strong></span><b>{oxygen ? 'Recorded' : 'No reading'}</b></div>
          <div><Thermometer /><span><small>Temperature</small><strong>{temperature ? Number(temperature.value) : '—'}<em>{temperature?.unit || ''}</em></strong></span><b>{temperature ? 'Recorded' : 'No reading'}</b></div>
        </div>
        <button className="text-button">View health profile <ChevronRight size={17} /></button>
      </section>

      <div className="dashboard-grid">
        <section className="timeline-column">
          <div className="section-title"><div><h2>Today's care</h2><p>{complete} of {tasks.length} tasks complete</p></div><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as CSSProperties}><span>{progress}%</span></div></div>
          {now && <div className="focus-card now-card">
            <div className="focus-label"><span><Clock3 size={15} /> DO NOW</span><strong>{now.time}</strong></div>
            <div className="focus-body"><TaskIcon task={now} large /><div className="focus-copy"><h3>{now.title}</h3><strong>{now.detail}</strong><p>{now.instructions}</p></div></div>
            <div className="focus-actions">{canRecordCare && <button className="complete-button" onClick={() => onComplete(now)}><Check size={20} /> Mark as done</button>}<button className="secondary-button" onClick={() => onTask(now)}>View details</button></div>
          </div>}
          {overdue.map((task) => <button className="overdue-card" key={task.id} onClick={() => onTask(task)}><span className="overdue-icon"><AlertCircle /></span><span><small>OVERDUE · {task.time}</small><strong>{task.title}</strong><em>{task.detail}</em></span><ChevronRight /></button>)}
          <div className="up-next"><div className="subsection-heading"><h3>Up next</h3><button>View schedule <ChevronRight size={16} /></button></div>{upcoming.map((task) => <TaskRow key={task.id} task={task} onClick={() => onTask(task)} />)}{!tasks.length && <div className="empty-care"><CheckCircle2 /><strong>No tasks scheduled</strong><p>Add a care task or wait for the schedule worker to generate today's plan.</p></div>}</div>
        </section>

        <aside className="dashboard-side">
          <div className="side-card shift-overview"><div className="subsection-heading"><h3>Shift overview</h3><button><MoreHorizontal /></button></div><div className="big-progress"><span>{complete}</span><small>of {tasks.length}<br />complete</small></div><div className="linear-progress"><i style={{ width: `${progress}%` }} /></div><div className="overview-legend"><span><i className="green" />{complete} complete</span><span><i className="amber" />{tasks.filter((task) => task.status === 'upcoming' || task.status === 'now').length} upcoming</span><span><i className="red" />{tasks.filter((task) => task.status === 'overdue').length} overdue</span></div></div>
          <div className="side-card handover-card"><span className="eyebrow"><ClipboardCheck size={15} /> SHIFT HANDOVER</span><h3>Ready for a safe handover?</h3><p>Review the actual next assignment and acknowledgement history.</p><button className="secondary-button" onClick={() => onNavigate('reports')}>Open shift reports <ChevronRight size={17} /></button></div>
          <div className="side-card family-card"><div className="family-head"><div className="avatar avatar-layla"><MessageCircle size={18} /></div><div><small>PATIENT CARE CIRCLE</small><strong>Authorized contacts</strong><span>Loaded from the clinical record</span></div></div><p>Open the patient-specific conversation or review authorized family contacts.</p><button onClick={() => onNavigate('messages')}>Open messages <ChevronRight size={16} /></button></div>
        </aside>
      </div>
    </>
  )
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <section className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</section>
}

function Schedule({ tasks, locale, selectedDate, onDate, onTask, onAdd }: { tasks: CareTask[]; locale: string; selectedDate: string; onDate: (date: string) => Promise<void>; onTask: (task: CareTask) => void; onAdd: () => void }) {
  const selected = new Date(`${selectedDate}T12:00:00`)
  const calendarLocale = locale === 'fa' ? 'fa-IR-u-ca-persian' : 'en'
  const dates = Array.from({ length: 7 }, (_, index) => { const date = new Date(selected); date.setDate(date.getDate() + index - 3); return date })
  return <><PageHeader eyebrow="CARE CALENDAR" title="Schedule" description={`Care plan for ${new Intl.DateTimeFormat(calendarLocale, { dateStyle: 'full' }).format(selected)}.`} action={<button className="primary-button" onClick={onAdd}><Plus size={19} /> Add task</button>} />
    <div className="schedule-layout"><section className="main-card schedule-card"><div className="calendar-head"><button aria-label="Previous day" onClick={() => { const date = new Date(selected); date.setDate(date.getDate() - 1); onDate(date.toISOString().slice(0, 10)) }}><ArrowLeft /></button><h3>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(selected)}</h3><button aria-label="Next day" onClick={() => { const date = new Date(selected); date.setDate(date.getDate() + 1); onDate(date.toISOString().slice(0, 10)) }}><ChevronRight /></button></div><div className="week-strip">{dates.map((date) => { const value = date.toISOString().slice(0, 10); return <button key={value} onClick={() => onDate(value)} className={value === selectedDate ? 'active' : ''} aria-pressed={value === selectedDate}><span>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date)}</span><strong>{date.getDate()}</strong>{value === new Date().toISOString().slice(0, 10) && <i />}</button> })}</div><div className="day-heading"><div><h2>{selectedDate === new Date().toISOString().slice(0, 10) ? 'Today' : new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(selected)}</h2><p>{tasks.length} care activities</p></div><span className="status-label"><i /> Live care plan</span></div><div className="schedule-timeline">{[...tasks].sort((a,b) => a.time.localeCompare(b.time)).map((task) => <button className={`schedule-item ${task.status}`} key={task.id} onClick={() => onTask(task)}><time>{task.time}</time><span className="timeline-dot" /><TaskIcon task={task} /><span><strong>{task.title}</strong><small>{task.detail}</small></span><span className="task-state">{task.status === 'done' ? <><Check size={15} /> Done</> : task.status}</span><ChevronRight /></button>)}</div></section><aside className="schedule-summary side-card"><h3>Day summary</h3><div className="summary-score"><strong>{tasks.length ? Math.round(tasks.filter((task) => task.status === 'done').length / tasks.length * 100) : 100}%</strong><span>Care plan<br />complete</span></div><div className="summary-list"><span><i className="green" />Completed <b>{tasks.filter(t => t.status === 'done').length}</b></span><span><i className="red" />Overdue <b>{tasks.filter(t => t.status === 'overdue').length}</b></span><span><i className="amber" />Remaining <b>{tasks.filter(t => t.status === 'upcoming' || t.status === 'now').length}</b></span></div></aside></div>
  </>
}

function Tasks({ tasks, onTask, onAdd }: { tasks: CareTask[]; onTask: (task: CareTask) => void; onAdd: () => void }) {
  const [filter, setFilter] = useState('All')
  const [query, setQuery] = useState('')
  const filtered = filter === 'All' ? tasks : tasks.filter((task) => task.status === filter.toLowerCase())
  const shown = filtered.filter((task) => `${task.title} ${task.detail}`.toLowerCase().includes(query.toLowerCase()))
  return <><PageHeader eyebrow="CARE PLAN" title="All tasks" description="Manage recurring and one-time care activities." action={<button className="primary-button" onClick={onAdd}><Plus size={19} /> Create task</button>} /><section className="main-card table-card"><div className="table-tools"><div className="filter-tabs" aria-label="Filter tasks">{['All','Now','Upcoming','Done'].map(item => <button key={item} className={filter === item ? 'active' : ''} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div><label className="search-field"><Search size={18} /><span className="sr-only">Search tasks</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks" /></label></div><div className="task-table"><div className="table-head" aria-hidden="true"><span>Task</span><span>Schedule</span><span>Status</span><span /></div>{shown.map(task => <button className="table-row" key={task.id} onClick={() => onTask(task)}><span className="table-task"><TaskIcon task={task} /><span><strong>{task.title}</strong><small>{task.detail}</small></span></span><span>{task.time} · Daily</span><span><b className={`status-pill ${task.status}`}>{task.status}</b></span><ChevronRight /></button>)}{!shown.length && <div className="empty-care"><Search /><strong>No matching tasks</strong><p>Try a different search or filter.</p></div>}</div></section></>
}

function Medications({ session, patient, medications, doses, onDose, notify, onRefresh }: { session: Session; patient: Patient; medications: Medication[]; doses: DoseLog[]; onDose: (dose: DoseLog) => void; notify: (message: string) => void; onRefresh: () => Promise<void> }) {
  const doseCount = doses.length
  const refillCount = medications.filter((medication) => medication.stock_quantity !== null && medication.stock_quantity < 14).length
  const colors = ['coral', 'teal', 'gold']
  const scanBarcode = async () => { const code = window.prompt('Scan or enter the medication barcode'); if (!code) return; try { const found = await lookupMedicationBarcode(session.token, code); notify(`${found.name} matched for ${found.patient_name}`) } catch (error) { notify(error instanceof Error ? error.message : 'Barcode did not match') } }
  const refill = async (medication: Medication) => { const quantity = Number(window.prompt(`How many ${medication.name} doses should be requested?`, '30')); if (!quantity) return; await requestRefill(session.token, medication.id, quantity, 'Requested from medication screen'); notify('Refill request recorded') }
  const prn = async (medication: Medication) => { const note = window.prompt(`Reason/assessment before giving ${medication.name}`); if (!note) return; if (!window.confirm(`Five-right check for ${patient.full_name}: confirm patient, ${medication.name}, ${Number(medication.dose)} ${medication.unit}, ${medication.route}, and current time.`)) return; await administerPrn(session.token, medication.id, note); await onRefresh(); notify('PRN administration recorded with five-right verification') }
  const reviewOrder = async (medication: Medication, decision: 'approve' | 'reject') => { const reason = decision === 'reject' ? window.prompt('Reason for rejecting this medication order') || '' : ''; if (decision === 'reject' && !reason) return; await reviewMedicationOrder(session.token, medication.id, decision, reason); await onRefresh(); notify(`Medication order ${decision === 'approve' ? 'approved' : 'rejected'}`) }
  return <><PageHeader eyebrow="MEDICATION SAFETY" title="Medications" description="Orders, PRN limits, interaction warnings, stock, refill requests, and late administration." action={<button className="secondary-button" onClick={scanBarcode}><Search /> Scan barcode</button>} /><div className="medication-summary"><div><Pill /><span><small>Scheduled doses</small><strong>{doseCount} today</strong></span></div><div><ShieldCheck /><span><small>Given safely</small><strong>{doses.filter((dose) => dose.status === 'GIVEN').length} recorded</strong></span></div><div><AlertCircle /><span><small>Needs attention</small><strong>{refillCount} refill{refillCount === 1 ? '' : 's'} soon</strong></span></div></div>
    {['DOCTOR', 'ADMIN'].includes(session.user.role) && medications.some((item) => item.approval_status === 'PENDING') && <section className="main-card order-review"><div className="subsection-heading"><div><h3>Medication orders awaiting review</h3><p>Review allergies, interactions, dates, dose, route, and indication before approval.</p></div></div>{medications.filter((item) => item.approval_status === 'PENDING').map((item) => <article className="audit-row" key={item.id}><Pill /><div><strong>{item.name} · {Number(item.dose)} {item.unit} · {item.route}</strong><small>{item.instructions || 'No additional instructions'}</small></div><div className="med-actions"><button className="primary-button" onClick={() => reviewOrder(item, 'approve')}>Approve</button><button className="danger-button" onClick={() => reviewOrder(item, 'reject')}>Reject</button></div></article>)}</section>}
    <section className="main-card dose-list" aria-labelledby="today-doses"><div className="subsection-heading"><div><h3 id="today-doses">Today&apos;s dose record</h3><p>Patient, medicine, dose, route, and time must be confirmed.</p></div></div>{doses.map((dose) => <button className="dose-row" key={dose.id} onClick={() => onDose(dose)}><span className={`dose-status ${dose.status.toLowerCase()}`}><Pill /></span><span><strong>{dose.medication_name}</strong><small>{Number(dose.dose)} {dose.unit} · {dose.route}</small></span><time>{new Date(dose.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><b className={`status-pill ${dose.status.toLowerCase()}`}>{dose.status.toLowerCase()}</b><ChevronRight /></button>)}{!doses.length && <div className="empty-care"><CheckCircle2 /><strong>No doses scheduled today</strong><p>The medication plan has no dose times for this day.</p></div>}</section>
    <section className="cards-grid medication-cards">{medications.map((medication, index) => { const remaining = medication.stock_quantity ?? 0; const schedule = medication.is_prn ? `PRN for ${medication.prn_reason}` : medication.schedules.map((item) => item.time.slice(0, 5)).join(' and ') || 'As directed'; return <article className="med-card" key={medication.id}><div className={`medicine-visual ${colors[index % colors.length]}`}><Pill /></div><span className="eyebrow">{medication.approval_status} {medication.is_prn ? 'PRN' : 'MEDICATION'}</span><h3>{medication.name}</h3><strong>{Number(medication.dose)} {medication.unit} · {medication.route}</strong><div className="med-details"><span><Clock3 />{schedule}</span><span><ClipboardCheck />{medication.instructions || 'Follow the medication order.'}</span>{medication.starts_on && <span>Order {medication.starts_on}–{medication.ends_on || 'ongoing'}</span>}</div>{medication.warnings.map((warning) => <div className="med-warning" key={warning.message}><TriangleAlert /> <span><strong>{warning.severity}</strong>{warning.message}<small>{warning.source}</small></span></div>)}<div className="stock-row"><span>{medication.stock_quantity === null ? 'Stock not tracked' : `${remaining} doses remaining`}</span><div><i style={{ width: `${Math.min(100, remaining * 2.5)}%` }} /></div></div><div className="med-actions"><button className="secondary-button" onClick={() => refill(medication)}>Request refill</button>{medication.is_prn && <button className="primary-button" onClick={() => prn(medication)}>Record PRN dose</button>}</div></article> })}</section></>
}

export function Health({ vitals, onRecord }: { vitals: VitalRecord[]; onRecord: () => void }) {
  const find = (type: VitalRecord['type']) => vitals.find((vital) => vital.type === type)
  const bp = find('BLOOD_PRESSURE')
  const oxygen = find('OXYGEN')
  const weight = find('WEIGHT')
  const temperature = find('TEMPERATURE')
  const displayValue = (vital?: VitalRecord) => vital ? String(Number(vital.value)) : '—'
  const typeLabel: Record<VitalRecord['type'], string> = { BLOOD_PRESSURE: 'Blood pressure', HEART_RATE: 'Heart rate', OXYGEN: 'Oxygen saturation', TEMPERATURE: 'Temperature', WEIGHT: 'Weight', GLUCOSE: 'Blood glucose' }
  return <><PageHeader eyebrow="HEALTH OVERVIEW" title="Health readings" description="Vitals and trends, without the noise." action={<button className="primary-button" onClick={onRecord}><Plus size={19} /> Record vital</button>} /><div className="health-grid"><section className="main-card bp-chart"><div className="chart-title"><div><span className="icon-box rose"><HeartPulse /></span><span><small>BLOOD PRESSURE</small><h3>{bp ? `${Number(bp.value)}/${Number(bp.secondary_value)}` : '—'} <em>{bp?.unit || ''}</em></h3></span></div><b className="normal-badge">Latest reading</b></div><div className="chart-tabs"><button className="active">7 days</button><button>30 days</button><button>3 months</button></div><svg viewBox="0 0 700 230" role="img" aria-label="Blood pressure trend"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3e8d7d" stopOpacity=".22"/><stop offset="1" stopColor="#3e8d7d" stopOpacity="0"/></linearGradient></defs>{[35,85,135,185].map(y => <line key={y} x1="35" y1={y} x2="680" y2={y} className="grid-line" />)}<path d="M40,110 C95,95 115,124 150,102 S218,75 260,90 S330,112 365,94 S430,65 470,84 S535,108 570,92 S630,74 675,82 L675,210 L40,210Z" fill="url(#area)"/><path d="M40,110 C95,95 115,124 150,102 S218,75 260,90 S330,112 365,94 S430,65 470,84 S535,108 570,92 S630,74 675,82" className="chart-line systolic"/><path d="M40,158 C92,150 120,168 150,154 S216,140 260,149 S325,163 365,151 S430,135 470,145 S535,159 570,148 S635,139 675,143" className="chart-line diastolic"/>{[40,150,260,365,470,570,675].map((x,i) => <text key={x} x={x} y="226" textAnchor="middle">{['Fri','Sat','Sun','Mon','Tue','Wed','Today'][i]}</text>)}</svg><div className="chart-legend"><span><i className="systolic" />Systolic</span><span><i className="diastolic" />Diastolic</span><small>{bp ? `Recorded ${new Date(bp.recorded_at).toLocaleString()}` : 'No reading recorded'}</small></div></section><div className="vital-cards"><VitalCard icon={<Activity />} label="Oxygen saturation" value={displayValue(oxygen)} unit={oxygen?.unit || ''} note="Latest" trend={oxygen ? new Date(oxygen.recorded_at).toLocaleString() : 'No reading'} color="blue" /><VitalCard icon={<Weight />} label="Weight" value={displayValue(weight)} unit={weight?.unit || ''} note="Latest" trend={weight ? new Date(weight.recorded_at).toLocaleString() : 'No reading'} color="gold" /><VitalCard icon={<Thermometer />} label="Temperature" value={displayValue(temperature)} unit={temperature?.unit || ''} note="Latest" trend={temperature ? new Date(temperature.recorded_at).toLocaleString() : 'No reading'} color="rose" /></div></div><section className="main-card recent-readings"><div className="subsection-heading"><h3>Latest readings</h3><button>Synced from care record</button></div>{vitals.map((vital) => <div className="reading-row" key={vital.id}><span>{new Date(vital.recorded_at).toLocaleString()}</span><strong>{typeLabel[vital.type]}</strong><b>{Number(vital.value)}{vital.secondary_value ? `/${Number(vital.secondary_value)}` : ''} {vital.unit}</b><em className="normal-badge">Recorded</em><span>{vital.recorded_by_name || 'Care team'}</span></div>)}</section></>
}

function VitalCard({ icon, label, value, unit, note, trend, color }: { icon: ReactNode; label: string; value: string; unit: string; note: string; trend: string; color: string }) {
  return <article className="vital-card"><div className={`icon-box ${color}`}>{icon}</div><small>{label}</small><h3>{value}<em>{unit}</em></h3><b className="normal-badge">{note}</b><p>{trend}</p></article>
}

export function Reports({ taskCount, vitalCount, onSend }: { taskCount: number; vitalCount: number; onSend: (observations: string, concerns: string) => Promise<void> }) {
  const [observations, setObservations] = useState('Patient was in good spirits this morning and followed the planned routine.')
  const [concerns, setConcerns] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => { setSending(true); setError(''); try { await onSend(observations, concerns) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Handover could not be saved.') } finally { setSending(false) } }
  return <><PageHeader eyebrow="CARE CONTINUITY" title="Reports & handovers" description="Leave the next caregiver with the full picture." /><div className="reports-grid"><section className="main-card report-composer"><span className="eyebrow"><Sun size={16} /> MORNING SHIFT · TODAY</span><h2>Shift handover</h2><p>Summarize today's care for the next caregiver.</p><div className="report-stats"><div><CheckCircle2 /><strong>{taskCount}</strong><span>Tasks complete</span></div><div><AlertCircle /><strong>{concerns ? 1 : 0}</strong><span>Issues reported</span></div><div><HeartPulse /><strong>{vitalCount}</strong><span>Vitals recorded</span></div></div><label>Observations<textarea value={observations} onChange={(event) => setObservations(event.target.value)} /></label><label>Concerns or follow-up<textarea value={concerns} onChange={(event) => setConcerns(event.target.value)} placeholder="Add anything the next caregiver should watch..." /></label>{error && <div className="login-error"><AlertCircle />{error}</div>}<button className="primary-button" onClick={submit} disabled={sending}><Send size={18} /> {sending ? 'Saving…' : 'Send handover'}</button></section><aside><div className="side-card next-caregiver"><span className="eyebrow">NEXT CAREGIVER</span><div className="caregiver-chip large"><div className="avatar avatar-james">JW</div><span><strong>Care team</strong><small>Next scheduled shift</small></span></div><p>The assigned care team can retrieve this handover from the API.</p></div><div className="side-card past-reports"><div className="subsection-heading"><h3>Care records</h3></div><button><FileText /><span><strong>Server-backed handovers</strong><small>Available to assigned caregivers</small></span><ChevronRight /></button></div></aside></div></>
}

export function Messages({ notify }: { notify: (message: string) => void }) {
  const [message, setMessage] = useState('')
  const send = () => { if (message.trim()) { setMessage(''); notify('Message sent to Layla') } }
  return <><PageHeader eyebrow="CARE CIRCLE" title="Messages" description="Keep Hassan's family and care team close." /><section className="main-card messages-layout"><aside className="conversation-list"><div className="search-field"><Search /><input placeholder="Search conversations" /></div><button className="active"><div className="avatar avatar-layla">LA</div><span><strong>Layla Abbasi</strong><p>How did Dad sleep last night?</p></span><time>5m</time></button><button><div className="avatar avatar-james">JW</div><span><strong>James Wilson</strong><p>I'll be there a little before 3.</p></span><time>1h</time></button><button><div className="avatar avatar-doctor">DR</div><span><strong>Dr. Rahimi</strong><p>His readings look stable.</p></span><time>Tue</time></button></aside><div className="chat"><header><div className="avatar avatar-layla">LA</div><span><strong>Layla Abbasi</strong><small><i /> Online · Hassan's daughter</small></span><button><MoreHorizontal /></button></header><div className="chat-body"><span className="chat-date">TODAY</span><div className="bubble incoming">Good morning, Sarah. How did Dad sleep last night?<time>09:18</time></div><div className="bubble outgoing">Good morning! He slept well — almost seven hours. He's had breakfast and is in a cheerful mood today.<time>09:21 · Read</time></div><div className="bubble incoming">That's wonderful. Thank you for letting me know ❤️<time>09:22</time></div></div><div className="message-compose"><button><Plus /></button><input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Write a message..." /><button className="send-button" onClick={send}><Send /></button></div></div></section></>
}

export function SettingsView({ user, onSignOut, notify }: { user: ApiUser; onSignOut: () => void; notify: (message: string) => void }) {
  const enableBrowserAlerts = async () => {
    if (!('Notification' in window)) { notify('This browser does not support system notifications'); return }
    const permission = await Notification.requestPermission()
    notify(permission === 'granted' ? 'Critical browser alerts enabled' : 'Browser alert permission was not granted')
  }
  return <><PageHeader eyebrow="YOUR WORKSPACE" title="Settings" description="Preferences, access, and notifications." /><div className="settings-layout"><section className="main-card settings-card"><h3>Profile</h3><div className="profile-settings"><div className="avatar avatar-sarah large-avatar">{initials(user.display_name)}</div><div><strong>{user.display_name}</strong><span>{user.role.toLowerCase()} · {user.email}</span><button>Account #{user.id}</button></div></div><hr /><h3>Notifications</h3><button className="settings-row" onClick={enableBrowserAlerts}><Bell /><span><strong>Enable critical browser alerts</strong><small>Allow Haven to alert you while another tab is open.</small></span><ChevronRight /></button><SettingToggle title="Task reminders" detail="Show reminders before scheduled care." checked /><SettingToggle title="Overdue escalation" detail="Escalate overdue care through the assigned team." checked /><hr /><h3>Security</h3><button className="settings-row"><ShieldCheck /><span><strong>Authenticated session</strong><small>Protected by your Haven API token</small></span><ChevronRight /></button><button className="settings-row" onClick={() => notify('Privacy settings opened')}><UserRound /><span><strong>Privacy & permissions</strong><small>Patient data is limited by active assignments</small></span><ChevronRight /></button></section><aside className="side-card signout-card"><LogOut /><h3>End your session</h3><p>Sign out safely when your shift is complete or you leave this device.</p><button className="danger-button" onClick={onSignOut}>Sign out</button></aside></div></>
}

function SettingToggle({ title, detail, checked }: { title: string; detail: string; checked?: boolean }) {
  const [on, setOn] = useState(Boolean(checked))
  return <button className="toggle-row" role="switch" aria-checked={on} onClick={() => setOn(!on)}><span><strong>{title}</strong><small>{detail}</small></span><i className={on ? 'on' : ''} aria-hidden="true"><b /></i></button>
}

function TaskIcon({ task, large = false }: { task: CareTask; large?: boolean }) {
  const Icon = categoryIcons[task.category]
  return <span className={`task-icon ${task.category} ${large ? 'large' : ''}`}><Icon /></span>
}

function TaskRow({ task, onClick }: { task: CareTask; onClick: () => void }) {
  return <button className="task-row" onClick={onClick}><time>{task.time}</time><TaskIcon task={task} /><span><strong>{task.title}</strong><small>{task.detail}</small></span><ChevronRight /></button>
}

function Modal({ children, onClose, label = 'Care dialog' }: { children: ReactNode; onClose: () => void; label?: string }) {
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
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close dialog" tabIndex={-1} /><section className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}><button className="modal-close" onClick={onClose} aria-label="Close dialog"><X /></button>{children}</section></div>
}

export function TaskModal({ task, patient, onClose, onSave }: { task: CareTask; patient: Patient; onClose: () => void; onSave: (task: CareTask, payload: Record<string, unknown>, correction?: boolean) => Promise<void> }) {
  const occurrence = task.occurrence
  const isCorrection = Boolean(occurrence && !['PENDING', 'DELAYED'].includes(occurrence.status))
  const [outcome, setOutcome] = useState('COMPLETED')
  const [correctedStatus, setCorrectedStatus] = useState('PENDING')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [identityConfirmed, setIdentityConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!identityConfirmed) { setError(`Confirm that this record is for ${patient.full_name}.`); return }
    if (!occurrence) { setError('This locally created task must synchronize before an outcome can be recorded.'); return }
    if (isCorrection && !reason.trim()) { setError('A correction reason is required.'); return }
    if (!isCorrection && outcome !== 'COMPLETED' && !note.trim()) { setError('Add a note explaining this outcome.'); return }
    setSaving(true); setError('')
    try {
      await onSave(task, isCorrection
        ? { corrected_status: correctedStatus, corrected_outcome: correctedStatus === 'DONE' ? outcome : '', reason, note }
        : { outcome, note }, isCorrection)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The care outcome could not be saved.')
    } finally { setSaving(false) }
  }
  return <Modal onClose={onClose} label={`${isCorrection ? 'Correct' : 'Record'} ${task.title}`}><div className="modal-task-head"><TaskIcon task={task} large /><span className="eyebrow">{isCorrection ? 'APPEND-ONLY CORRECTION' : task.category.toUpperCase()}</span><h2>{task.title}</h2><p>{patient.full_name} · scheduled {task.time}</p></div><div className="instruction-box"><span>CARE INSTRUCTIONS</span><p>{task.instructions || 'Follow the care plan and record any relevant observations.'}</p></div>
    <form className="task-form safety-form" onSubmit={submit}>{isCorrection ? <><div className="safety-warning"><RotateCcw /><span><strong>The original record will remain visible.</strong><small>This adds a correction to the audit trail.</small></span></div><label>Corrected status<select value={correctedStatus} onChange={(event) => setCorrectedStatus(event.target.value)}><option value="PENDING">Reopen as pending</option><option value="DONE">Completed</option><option value="MISSED">Unable / missed</option><option value="SKIPPED">Patient refused</option></select></label>{correctedStatus === 'DONE' && <label>Corrected outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="COMPLETED">Completed as planned</option><option value="PARTIAL">Partially completed</option></select></label>}<label>Reason for correction<input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="What was recorded incorrectly?" /></label></> : <label>Care outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="COMPLETED">Completed as planned</option><option value="PARTIAL">Partially completed</option><option value="UNABLE">Unable to complete</option><option value="REFUSED">Patient refused</option></select></label>}
      <label>{isCorrection ? 'Additional note' : 'Care note'}<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Observations, measurements, or follow-up needed" /></label><label className="verification-check"><input type="checkbox" checked={identityConfirmed} onChange={(event) => setIdentityConfirmed(event.target.checked)} /><span>I confirmed this care record is for <strong>{patient.full_name}</strong>.</span></label>{error && <div className="login-error"><AlertCircle />{error}</div>}<button className={isCorrection ? 'primary-button' : 'complete-button'} disabled={saving}><Save />{saving ? 'Saving…' : isCorrection ? 'Add correction' : 'Record outcome'}</button>
    </form>{occurrence && (occurrence.completion || occurrence.corrections.length > 0) && <div className="audit-preview"><h3>Record history</h3>{occurrence.completion && <div className="history-row"><span><CheckCircle2 />Original: {occurrence.completion.outcome.toLowerCase()}</span><b>{occurrence.completion.completed_by_name}</b></div>}{occurrence.corrections.map((item) => <div className="history-row" key={item.id}><span><RotateCcw />{item.corrected_status.toLowerCase()}</span><b>{item.reason}</b></div>)}</div>}</Modal>
}

export function DoseModal({ dose, patient, onClose, onSave }: { dose: DoseLog; patient: Patient; onClose: () => void; onSave: (dose: DoseLog, payload: Record<string, unknown>, action: 'administer' | 'outcome' | 'correct') => Promise<void> }) {
  const correction = dose.status !== 'SCHEDULED'
  const [status, setStatus] = useState(correction ? 'SCHEDULED' : 'GIVEN')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [checks, setChecks] = useState({ patient: false, medication: false, dose: false, route: false, time: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const setCheck = (key: keyof typeof checks, value: boolean) => setChecks((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (correction && !reason.trim()) { setError('A correction reason is required.'); return }
    if (!correction && status === 'GIVEN' && Object.values(checks).some((value) => !value)) { setError('Confirm all five medication checks.'); return }
    if (!correction && status !== 'GIVEN' && !reason.trim()) { setError('Explain why this dose was not given.'); return }
    setSaving(true)
    try {
      if (correction) await onSave(dose, { corrected_status: status, reason, note }, 'correct')
      else if (status === 'GIVEN') await onSave(dose, { note, verified_patient: checks.patient, verified_medication: checks.medication, verified_dose: checks.dose, verified_route: checks.route, verified_time: checks.time }, 'administer')
      else await onSave(dose, { status, reason }, 'outcome')
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'The dose record could not be saved.') }
    finally { setSaving(false) }
  }
  return <Modal onClose={onClose} label={`${correction ? 'Correct' : 'Verify'} medication dose`}><div className="dose-hero"><span className="task-icon medication large"><Pill /></span><span className="eyebrow">{correction ? 'DOSE CORRECTION' : 'FIVE-RIGHT CHECK'}</span><h2>{dose.medication_name}</h2><p>{Number(dose.dose)} {dose.unit} · {dose.route} · {new Date(dose.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div><form className="task-form safety-form" onSubmit={submit}><label>{correction ? 'Corrected status' : 'Dose outcome'}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="GIVEN">Given</option><option value="SCHEDULED">Reopen as scheduled</option><option value="HELD">Held</option><option value="REFUSED">Patient refused</option><option value="MISSED">Missed</option></select></label>{!correction && status === 'GIVEN' && <fieldset className="verification-list"><legend>Confirm before administration</legend><Verification checked={checks.patient} onChange={(value) => setCheck('patient', value)} title="Right patient" detail={patient.full_name} /><Verification checked={checks.medication} onChange={(value) => setCheck('medication', value)} title="Right medication" detail={dose.medication_name} /><Verification checked={checks.dose} onChange={(value) => setCheck('dose', value)} title="Right dose" detail={`${Number(dose.dose)} ${dose.unit}`} /><Verification checked={checks.route} onChange={(value) => setCheck('route', value)} title="Right route" detail={dose.route} /><Verification checked={checks.time} onChange={(value) => setCheck('time', value)} title="Right time" detail={new Date(dose.scheduled_at).toLocaleString()} /></fieldset>}{(correction || status !== 'GIVEN') && <label>{correction ? 'Reason for correction' : 'Reason'}<input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Required for safety review" /></label>}<label>Clinical note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional observation or follow-up" /></label>{error && <div className="login-error"><AlertCircle />{error}</div>}<button className="primary-button" disabled={saving}><ShieldCheck />{saving ? 'Saving…' : correction ? 'Add dose correction' : 'Record dose outcome'}</button></form>{dose.corrections.length > 0 && <div className="audit-preview"><h3>Previous corrections</h3>{dose.corrections.map((item) => <div className="history-row" key={item.id}><span><RotateCcw />{item.previous_status} → {item.corrected_status}</span><b>{item.reason}</b></div>)}</div>}</Modal>
}

function Verification({ checked, onChange, title, detail }: { checked: boolean; onChange: (value: boolean) => void; title: string; detail: string }) {
  return <label className="verification-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{title}</strong><small>{detail}</small></span></label>
}

function NotificationPanel({ notifications, onClose, onAction }: { notifications: CareNotification[]; onClose: () => void; onAction: (item: CareNotification, action: 'acknowledge' | 'snooze') => Promise<void> }) {
  const active = notifications.filter((item) => item.state !== 'ACKNOWLEDGED' && !(item.state === 'SNOOZED' && item.snoozed_until && new Date(item.snoozed_until) > new Date()))
  return <aside className="notification-panel" role="region" aria-label="Care alerts"><header><div><span className="eyebrow">LIVE ESCALATION</span><h2>Care alerts</h2></div><button className="modal-close" onClick={onClose} aria-label="Close alerts"><X /></button></header>{active.map((item) => <article className={`notification-item ${item.severity.toLowerCase()}`} key={item.id}><span><TriangleAlert /></span><div><small>{item.severity} · LEVEL {item.escalation_level}</small><h3>{item.title}</h3><p>{item.message}</p><div><button className="primary-button" onClick={() => onAction(item, 'acknowledge')}>Acknowledge</button><button className="secondary-button" onClick={() => onAction(item, 'snooze')}>Snooze 15 min</button></div></div></article>)}{!active.length && <div className="empty-care"><CheckCircle2 /><strong>No active alerts</strong><p>Overdue tasks and medication doses will appear here.</p></div>}</aside>
}

function SafetyLog({ events, mutations, onResolve, onRefresh }: { events: AuditEvent[]; mutations: QueuedMutation[]; onResolve: (item: QueuedMutation, action: 'retry' | 'discard') => Promise<void>; onRefresh: () => Promise<void> }) {
  return <><PageHeader eyebrow="TRACEABLE CARE" title="Safety & sync log" description="Review corrections, actions, and offline records that need attention." action={<button className="secondary-button" onClick={onRefresh}><RefreshCw /> Refresh</button>} /><div className="safety-grid"><section className="main-card sync-review"><div className="subsection-heading"><div><h3>Offline synchronization</h3><p>{mutations.length ? `${mutations.length} change${mutations.length === 1 ? '' : 's'} not yet synchronized` : 'All clinical changes are synchronized'}</p></div></div>{mutations.map((item) => <article className={`sync-item ${item.status || 'pending'}`} key={item.id}><span>{item.status === 'conflict' ? <TriangleAlert /> : item.status === 'failed' ? <AlertCircle /> : <Cloud />}</span><div><strong>{item.path.replaceAll('/', ' ').trim()}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.status || 'pending'} · {item.attempts} retries</small>{item.lastError && <p>{item.lastError}</p>}{item.status === 'conflict' && <details className="conflict-compare"><summary>Compare queued and server records</summary><div><span><b>Queued change</b><code>{JSON.stringify(item.body, null, 2)}</code></span><span><b>Current server record</b><code>{JSON.stringify(item.serverState, null, 2)}</code></span></div></details>}</div><div><button className="secondary-button" onClick={() => onResolve(item, 'retry')}><RotateCcw /> Retry with current version</button><button className="text-button danger-text" onClick={() => onResolve(item, 'discard')}>Discard</button></div></article>)}{!mutations.length && <div className="empty-care compact"><Cloud /><strong>Everything is synchronized</strong></div>}</section><section className="main-card audit-log"><div className="subsection-heading"><div><h3>Append-only audit trail</h3><p>Original outcomes remain visible after a correction.</p></div></div>{events.map((event) => <article className="audit-row" key={event.id}><span><History /></span><div><strong>{event.summary}</strong><small>{event.actor_name || 'System'} · {new Date(event.created_at).toLocaleString()}</small></div><b>{event.action.replaceAll('_', ' ').toLowerCase()}</b></article>)}{!events.length && <div className="empty-care compact"><History /><strong>No audited actions yet</strong></div>}</section></div></>
}

function AddTaskModal({ patient, onClose, onAdd }: { patient: Patient; onClose: () => void; onAdd: (task: Omit<CareTask, 'id' | 'status'>) => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<CareTask['category']>('care')
  const [time, setTime] = useState('12:00')
  const submit = (event: FormEvent) => { event.preventDefault(); if (title.trim()) onAdd({ title, time, category, detail: 'Daily care activity', instructions: 'Follow the documented care plan.' }) }
  return <Modal onClose={onClose} label="Create care task"><span className="eyebrow">NEW CARE ACTIVITY</span><h2>Create a task</h2><p className="modal-intro">Add a clear, scheduled action to <strong>{patient.full_name}</strong>&apos;s care plan.</p><form className="task-form" onSubmit={submit}><label>Task name<input autoFocus required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Change bed linens" /></label><div className="form-row"><label>Category<select value={category} onChange={e => setCategory(e.target.value as CareTask['category'])}><option value="care">Personal care</option><option value="medication">Medication</option><option value="health">Health check</option><option value="meal">Meal</option><option value="activity">Activity</option></select></label><label>Time<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label></div><label>Repeat<select defaultValue="daily"><option value="once">One time</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></label><button className="primary-button">Create task</button></form></Modal>
}

function VitalModal({ onClose, onSave }: { onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
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
      setError(requestError instanceof Error ? requestError.message : 'Reading could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  return <Modal onClose={onClose}><span className="eyebrow">NEW HEALTH READING</span><h2>Record a vital</h2><p className="modal-intro">The reading is timestamped and attributed to your account.</p><form className="task-form" onSubmit={submit}><label>Vital type<select value={type} onChange={(event) => setType(event.target.value as VitalRecord['type'])}><option value="BLOOD_PRESSURE">Blood pressure</option><option value="HEART_RATE">Heart rate</option><option value="OXYGEN">Oxygen saturation</option><option value="TEMPERATURE">Temperature</option><option value="WEIGHT">Weight</option><option value="GLUCOSE">Blood glucose</option></select></label><div className="form-row"><label>{type === 'BLOOD_PRESSURE' ? 'Systolic' : 'Value'}<input type="number" step="0.1" min="0" required value={value} onChange={(event) => setValue(event.target.value)} /></label>{type === 'BLOOD_PRESSURE' && <label>Diastolic<input type="number" step="1" min="0" required value={secondary} onChange={(event) => setSecondary(event.target.value)} /></label>}</div><p className="form-unit">Unit: {units[type]}</p>{error && <div className="login-error"><AlertCircle />{error}</div>}<button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save reading'}</button></form></Modal>
}

export default App
