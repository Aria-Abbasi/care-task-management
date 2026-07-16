import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useState } from 'react'
import {
  Activity, AlertCircle, ArrowLeft, Bell, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ClipboardCheck, Clock3, HeartPulse, Home,
  LogOut, Menu, MessageCircle, MoreHorizontal, Plus, Search, Settings,
  ShieldCheck, Sparkles, Stethoscope, Sun, Thermometer, UserRound,
  Weight, X, Pill, Footprints, Utensils, Send, FileText, Cloud, CloudOff, RefreshCw,
} from 'lucide-react'
import {
  ApiError,
  clearSession,
  flushMutationQueue,
  getPrimaryDashboard,
  loadSession,
  login,
  logout,
  mutateOrQueue,
  saveSession,
} from './lib/api'
import { cacheDashboard, clearOfflineData, pendingMutationCount, queuedMutationOwners, readCachedDashboard } from './lib/offline'
import type { ApiUser, DashboardResponse, Medication, Patient, Session, VitalRecord } from './lib/types'

type View = 'today' | 'schedule' | 'tasks' | 'medications' | 'health' | 'reports' | 'messages' | 'settings'
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
}

const categoryFromApi: Record<string, CareTask['category']> = {
  MEDICATION: 'medication',
  HEALTH: 'health',
  MEAL: 'meal',
  ACTIVITY: 'activity',
  PERSONAL_CARE: 'care',
  OTHER: 'care',
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
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'messages', label: 'Messages', icon: MessageCircle },
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
  const [loadingWorkspace, setLoadingWorkspace] = useState(Boolean(session))
  const [workspaceError, setWorkspaceError] = useState('')
  const [view, setView] = useState<View>('today')
  const [tasks, setTasks] = useState<CareTask[]>([])
  const [selectedTask, setSelectedTask] = useState<CareTask | null>(null)
  const [showAddTask, setShowAddTask] = useState(false)
  const [showVital, setShowVital] = useState(false)
  const [toast, setToast] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [pendingSync, setPendingSync] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }, [])

  const refreshWorkspace = useCallback(async (activeSession: Session) => {
    setLoadingWorkspace(true)
    try {
      const nextDashboard = await getPrimaryDashboard(activeSession.token)
      setDashboard(nextDashboard)
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
      const cached = await readCachedDashboard(activeSession.user.id).catch(() => null)
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
  }, [])

  const updatePendingCount = useCallback(async () => {
    setPendingSync(session ? await pendingMutationCount(session.user.id).catch(() => 0) : 0)
  }, [session])

  const syncNow = useCallback(async () => {
    if (!session || !navigator.onLine || syncing) return
    setSyncing(true)
    try {
      const synced = await flushMutationQueue(session.token, session.user.id)
      await updatePendingCount()
      if (synced) {
        await refreshWorkspace(session)
        notify(`${synced} offline ${synced === 1 ? 'change' : 'changes'} synced`)
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
    if (!online || !session) return
    let cancelled = false
    const run = async () => {
      setSyncing(true)
      try {
        const synced = await flushMutationQueue(session.token, session.user.id)
        if (cancelled) return
        await updatePendingCount()
        if (synced) {
          await refreshWorkspace(session)
          notify(`${synced} offline ${synced === 1 ? 'change' : 'changes'} synced`)
        }
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [notify, online, refreshWorkspace, session, updatePendingCount])

  const handleLogin = async (loginValue: string, password: string, remember: boolean) => {
    const nextSession = await login(loginValue, password)
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

  const completeTask = async (task: CareTask) => {
    const previousStatus = task.status
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'done' } : item))
    setDashboard((current) => {
      if (!current) return current
      const next = { ...current, occurrences: current.occurrences.map((item) => item.id === task.id ? { ...item, status: 'DONE' as const, completed_at: new Date().toISOString() } : item) }
      if (session) cacheDashboard(next, session.user.id).catch(() => undefined)
      return next
    })
    setSelectedTask(null)
    if (!session || task.localOnly) {
      notify(`${task.title} marked complete locally`)
      return
    }
    const reference = crypto.randomUUID()
    try {
      const result = await mutateOrQueue(session.token, {
        id: reference,
        userId: session.user.id,
        path: `/occurrences/${task.id}/complete/`,
        method: 'POST',
        body: { client_reference: reference },
      })
      await updatePendingCount()
      notify(result.queued ? `${task.title} saved offline` : `${task.title} marked complete`)
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: previousStatus } : item))
      setDashboard((current) => {
        if (!current) return current
        const apiStatus = previousStatus === 'done' ? 'DONE' : previousStatus === 'overdue' ? 'MISSED' : 'PENDING'
        const next = { ...current, occurrences: current.occurrences.map((item) => item.id === task.id ? { ...item, status: apiStatus as 'DONE' | 'MISSED' | 'PENDING', completed_at: null } : item) }
        cacheDashboard(next, session.user.id).catch(() => undefined)
        return next
      })
      notify(error instanceof Error ? error.message : 'Task could not be completed')
    }
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

  if (!session || authExpired) return <Login onLogin={handleLogin} />

  if (loadingWorkspace && !dashboard) return <LoadingScreen />

  if (!dashboard) return <WorkspaceError message={workspaceError} onRetry={() => refreshWorkspace(session)} onSignOut={signOut} />

  const activeLabel = navigation.find((item) => item.id === view)?.label
  const patient = dashboard.patient
  const user = session.user

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="brand"><BrandMark /><span>haven</span></div>
        <button className="mobile-close" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X /></button>
        <div className="patient-mini">
          <div className="avatar avatar-hassan">{initials(patient.full_name)}</div>
          <div><strong>{patient.full_name}</strong><span>Primary patient</span></div>
          <ChevronDown size={17} />
        </div>
        <nav>
          <span className="nav-heading">CARE WORKSPACE</span>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setMobileMenu(false) }}>
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

      <main>
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu /></button>
            <div><span className="mobile-page-title">{activeLabel}</span><span className="breadcrumb">{patient.first_name}'s care <ChevronRight size={13} /> {activeLabel}</span></div>
          </div>
          <div className="topbar-actions">
            <button className={`sync-status ${online ? '' : 'offline'}`} onClick={syncNow} title={online ? `${pendingSync} pending changes` : 'Working offline'}>
              {syncing ? <RefreshCw className="spinning" /> : online ? <Cloud /> : <CloudOff />}
              <span>{syncing ? 'Syncing' : !online ? 'Offline' : pendingSync ? `${pendingSync} pending` : 'Synced'}</span>
            </button>
            <button className="icon-button search-button" aria-label="Search"><Search size={19} /></button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={19} /><i /></button>
            <div className="avatar avatar-sarah top-avatar">{initials(user.display_name)}</div>
          </div>
        </header>

        <div className="content">
          {workspaceError && <div className="workspace-notice"><CloudOff />{workspaceError}</div>}
          {view === 'today' && <Dashboard tasks={tasks} patient={patient} user={user} vitals={dashboard.latest_vitals} onTask={setSelectedTask} onComplete={completeTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'schedule' && <Schedule tasks={tasks} onTask={setSelectedTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'tasks' && <Tasks tasks={tasks} onTask={setSelectedTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'medications' && <Medications medications={dashboard.medications} notify={notify} />}
          {view === 'health' && <Health vitals={dashboard.latest_vitals} onRecord={() => setShowVital(true)} />}
          {view === 'reports' && <Reports taskCount={tasks.filter((task) => task.status === 'done').length} vitalCount={dashboard.latest_vitals.length} onSend={sendReport} />}
          {view === 'messages' && <Messages notify={notify} />}
          {view === 'settings' && <SettingsView user={user} onSignOut={signOut} notify={notify} />}
        </div>
      </main>

      <nav className="bottom-nav">
        {navigation.slice(0, 4).map(({ id, label, icon: Icon }) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon /><span>{label}</span></button>
        ))}
        <button className={!navigation.slice(0, 4).some((item) => item.id === view) ? 'active' : ''} onClick={() => setMobileMenu(true)}><Menu /><span>More</span></button>
      </nav>

      {selectedTask && <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} onComplete={() => completeTask(selectedTask)} notify={notify} />}
      {showAddTask && <AddTaskModal onClose={() => setShowAddTask(false)} onAdd={addTask} />}
      {showVital && <VitalModal onClose={() => setShowVital(false)} onSave={recordVital} />}
      {toast && <div className="toast"><CheckCircle2 size={19} />{toast}</div>}
    </div>
  )
}

function BrandMark() {
  return <span className="brand-mark"><HeartPulse size={20} strokeWidth={2.5} /></span>
}

function Login({ onLogin }: { onLogin: (loginValue: string, password: string, remember: boolean) => Promise<void> }) {
  const [showPassword, setShowPassword] = useState(false)
  const [loginValue, setLoginValue] = useState('sarah@havencare.com')
  const [password, setPassword] = useState('caregiver')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onLogin(loginValue, password, remember)
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
          <div className="login-options"><label className="checkbox"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><span>Keep me signed in</span></label><button type="button">Forgot password?</button></div>
          {error && <div className="login-error"><AlertCircle />{error}</div>}
          <button className="primary-button login-button" disabled={submitting}>{submitting ? <><RefreshCw className="spinning" /> Signing in…</> : <>Sign in securely <ChevronRight size={18} /></>}</button>
          <div className="secure-note"><ShieldCheck size={16} /> Access is authenticated and limited to assigned care teams.</div>
        </form>
      </section>
    </div>
  )
}

function LoadingScreen() {
  return <div className="state-page"><div className="state-card"><BrandMark /><RefreshCw className="spinning state-spinner" /><h2>Loading the care plan</h2><p>Retrieving the latest tasks, medications, and health readings.</p></div></div>
}

function WorkspaceError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return <div className="state-page"><div className="state-card error"><AlertCircle /><h2>Care workspace unavailable</h2><p>{message}</p><button className="primary-button" onClick={onRetry}><RefreshCw /> Try again</button><button className="text-button" onClick={onSignOut}>Sign out</button></div></div>
}

function Dashboard({ tasks, patient, user, vitals, onTask, onComplete, onAdd }: { tasks: CareTask[]; patient: Patient; user: ApiUser; vitals: VitalRecord[]; onTask: (task: CareTask) => void; onComplete: (task: CareTask) => void; onAdd: () => void }) {
  const complete = tasks.filter((task) => task.status === 'done').length
  const now = tasks.find((task) => task.status === 'now')
  const overdue = tasks.find((task) => task.status === 'overdue')
  const upcoming = tasks.filter((task) => task.status === 'upcoming').slice(0, 3)
  const progress = tasks.length ? Math.round((complete / tasks.length) * 100) : 0
  const bloodPressure = vitals.find((vital) => vital.type === 'BLOOD_PRESSURE')
  const oxygen = vitals.find((vital) => vital.type === 'OXYGEN')
  const temperature = vitals.find((vital) => vital.type === 'TEMPERATURE')
  const todayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase()
  return (
    <>
      <section className="welcome-row">
        <div><span className="eyebrow">{todayLabel}</span><h1>Good morning, {user.first_name || user.display_name}</h1><p>Here's what {patient.first_name} needs today.</p></div>
        <button className="primary-button" onClick={onAdd}><Plus size={19} /> Add task</button>
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
            <div className="focus-body"><TaskIcon task={now} large /><div className="focus-copy" onClick={() => onTask(now)}><h3>{now.title}</h3><strong>{now.detail}</strong><p>{now.instructions}</p></div></div>
            <div className="focus-actions"><button className="complete-button" onClick={() => onComplete(now)}><Check size={20} /> Mark as done</button><button className="secondary-button" onClick={() => onTask(now)}>View details</button></div>
          </div>}
          {overdue && <button className="overdue-card" onClick={() => onTask(overdue)}><span className="overdue-icon"><AlertCircle /></span><span><small>OVERDUE · {overdue.time}</small><strong>{overdue.title}</strong><em>{overdue.detail}</em></span><ChevronRight /></button>}
          <div className="up-next"><div className="subsection-heading"><h3>Up next</h3><button>View schedule <ChevronRight size={16} /></button></div>{upcoming.map((task) => <TaskRow key={task.id} task={task} onClick={() => onTask(task)} />)}{!tasks.length && <div className="empty-care"><CheckCircle2 /><strong>No tasks scheduled</strong><p>Add a care task or wait for the schedule worker to generate today's plan.</p></div>}</div>
        </section>

        <aside className="dashboard-side">
          <div className="side-card shift-overview"><div className="subsection-heading"><h3>Shift overview</h3><button><MoreHorizontal /></button></div><div className="big-progress"><span>{complete}</span><small>of {tasks.length}<br />complete</small></div><div className="linear-progress"><i style={{ width: `${progress}%` }} /></div><div className="overview-legend"><span><i className="green" />{complete} complete</span><span><i className="amber" />{tasks.filter((task) => task.status === 'upcoming' || task.status === 'now').length} upcoming</span><span><i className="red" />{tasks.filter((task) => task.status === 'overdue').length} overdue</span></div></div>
          <div className="side-card handover-card"><span className="eyebrow"><ClipboardCheck size={15} /> SHIFT HANDOVER</span><h3>Ready for a smooth handover?</h3><p>Capture notes and concerns for the next caregiver before 15:00.</p><button className="secondary-button">Start shift report <ChevronRight size={17} /></button></div>
          <div className="side-card family-card"><div className="family-head"><div className="avatar avatar-layla">LA</div><div><small>FAMILY CONTACT</small><strong>Layla Abbasi</strong><span>Last updated 5 min ago</span></div><button><MessageCircle size={18} /></button></div><p>“How did Dad sleep last night?”</p><button>Reply to Layla <ChevronRight size={16} /></button></div>
        </aside>
      </div>
    </>
  )
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <section className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</section>
}

function Schedule({ tasks, onTask, onAdd }: { tasks: CareTask[]; onTask: (task: CareTask) => void; onAdd: () => void }) {
  const [day, setDay] = useState(2)
  const dates = ['14', '15', '16', '17', '18', '19', '20']
  return <><PageHeader eyebrow="CARE CALENDAR" title="Schedule" description="A clear view of Hassan's care plan." action={<button className="primary-button" onClick={onAdd}><Plus size={19} /> Add task</button>} />
    <div className="schedule-layout"><section className="main-card schedule-card"><div className="calendar-head"><button><ArrowLeft /></button><h3>July 2026</h3><button><ChevronRight /></button></div><div className="week-strip">{dates.map((date, index) => <button key={date} onClick={() => setDay(index)} className={day === index ? 'active' : ''}><span>{['Tue','Wed','Thu','Fri','Sat','Sun','Mon'][index]}</span><strong>{date}</strong>{index === 2 && <i />}</button>)}</div><div className="day-heading"><div><h2>{day === 2 ? 'Today' : `${['Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Monday'][day]}, July ${dates[day]}`}</h2><p>{tasks.length} care activities</p></div><span className="status-label"><i /> On track</span></div><div className="schedule-timeline">{[...tasks].sort((a,b) => a.time.localeCompare(b.time)).map((task) => <div className={`schedule-item ${task.status}`} key={task.id} onClick={() => onTask(task)}><time>{task.time}</time><span className="timeline-dot" /><TaskIcon task={task} /><div><strong>{task.title}</strong><p>{task.detail}</p></div><span className="task-state">{task.status === 'done' ? <><Check size={15} /> Done</> : task.status}</span><ChevronRight /></div>)}</div></section><aside className="schedule-summary side-card"><h3>Day summary</h3><div className="summary-score"><strong>75%</strong><span>Care plan<br />on track</span></div><div className="summary-list"><span><i className="green" />Completed <b>{tasks.filter(t => t.status === 'done').length}</b></span><span><i className="red" />Overdue <b>{tasks.filter(t => t.status === 'overdue').length}</b></span><span><i className="amber" />Remaining <b>{tasks.filter(t => t.status === 'upcoming' || t.status === 'now').length}</b></span></div><hr /><h4>Next shift</h4><p>James Wilson takes over at 15:00.</p><div className="caregiver-chip"><div className="avatar avatar-james">JW</div><span><strong>James Wilson</strong><small>Evening caregiver</small></span></div></aside></div>
  </>
}

function Tasks({ tasks, onTask, onAdd }: { tasks: CareTask[]; onTask: (task: CareTask) => void; onAdd: () => void }) {
  const [filter, setFilter] = useState('All')
  const shown = filter === 'All' ? tasks : tasks.filter((task) => task.status === filter.toLowerCase())
  return <><PageHeader eyebrow="CARE PLAN" title="All tasks" description="Manage recurring and one-time care activities." action={<button className="primary-button" onClick={onAdd}><Plus size={19} /> Create task</button>} /><section className="main-card table-card"><div className="table-tools"><div className="filter-tabs">{['All','Now','Upcoming','Done'].map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><div className="search-field"><Search size={18} /><input placeholder="Search tasks" /></div></div><div className="task-table"><div className="table-head"><span>Task</span><span>Schedule</span><span>Status</span><span /></div>{shown.map(task => <button className="table-row" key={task.id} onClick={() => onTask(task)}><span className="table-task"><TaskIcon task={task} /><span><strong>{task.title}</strong><small>{task.detail}</small></span></span><span>{task.time} · Daily</span><span><b className={`status-pill ${task.status}`}>{task.status}</b></span><ChevronRight /></button>)}</div></section></>
}

function Medications({ medications, notify }: { medications: Medication[]; notify: (message: string) => void }) {
  const doseCount = medications.reduce((total, medication) => total + medication.schedules.length, 0)
  const refillCount = medications.filter((medication) => medication.stock_quantity !== null && medication.stock_quantity < 14).length
  const colors = ['coral', 'teal', 'gold']
  return <><PageHeader eyebrow="MEDICATION SAFETY" title="Medications" description="Doses, schedules, and adherence in one place." action={<button className="primary-button" onClick={() => notify('Medication creation is available through the clinical API')}><Plus size={19} /> Add medication</button>} /><div className="medication-summary"><div><Pill /><span><small>Scheduled doses</small><strong>{doseCount} today</strong></span></div><div><ShieldCheck /><span><small>Active medications</small><strong>{medications.length} on plan</strong></span></div><div><AlertCircle /><span><small>Needs attention</small><strong>{refillCount} refill{refillCount === 1 ? '' : 's'} soon</strong></span></div></div><section className="cards-grid">{medications.map((medication, index) => { const remaining = medication.stock_quantity ?? 0; const schedule = medication.schedules.map((item) => item.time.slice(0, 5)).join(' and ') || 'As directed'; return <article className="med-card" key={medication.id}><div className={`medicine-visual ${colors[index % colors.length]}`}><Pill /></div><button className="more-button"><MoreHorizontal /></button><span className="eyebrow">ACTIVE MEDICATION</span><h3>{medication.name}</h3><strong>{Number(medication.dose)} {medication.unit}</strong><div className="med-details"><span><Clock3 />{schedule}</span><span><ClipboardCheck />{medication.instructions || medication.route}</span></div><div className="stock-row"><span>{remaining || 'Unknown'} doses remaining</span><div><i style={{ width: `${Math.min(100, remaining * 2.5)}%` }} /></div></div><button className="secondary-button" onClick={() => notify(`${medication.name} details opened`)}>View medication <ChevronRight /></button></article> })}{!medications.length && <div className="empty-care"><Pill /><strong>No active medications</strong><p>Add medication orders through the care API.</p></div>}</section></>
}

function Health({ vitals, onRecord }: { vitals: VitalRecord[]; onRecord: () => void }) {
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

function Reports({ taskCount, vitalCount, onSend }: { taskCount: number; vitalCount: number; onSend: (observations: string, concerns: string) => Promise<void> }) {
  const [observations, setObservations] = useState('Patient was in good spirits this morning and followed the planned routine.')
  const [concerns, setConcerns] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => { setSending(true); setError(''); try { await onSend(observations, concerns) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Handover could not be saved.') } finally { setSending(false) } }
  return <><PageHeader eyebrow="CARE CONTINUITY" title="Reports & handovers" description="Leave the next caregiver with the full picture." /><div className="reports-grid"><section className="main-card report-composer"><span className="eyebrow"><Sun size={16} /> MORNING SHIFT · TODAY</span><h2>Shift handover</h2><p>Summarize today's care for the next caregiver.</p><div className="report-stats"><div><CheckCircle2 /><strong>{taskCount}</strong><span>Tasks complete</span></div><div><AlertCircle /><strong>{concerns ? 1 : 0}</strong><span>Issues reported</span></div><div><HeartPulse /><strong>{vitalCount}</strong><span>Vitals recorded</span></div></div><label>Observations<textarea value={observations} onChange={(event) => setObservations(event.target.value)} /></label><label>Concerns or follow-up<textarea value={concerns} onChange={(event) => setConcerns(event.target.value)} placeholder="Add anything the next caregiver should watch..." /></label>{error && <div className="login-error"><AlertCircle />{error}</div>}<button className="primary-button" onClick={submit} disabled={sending}><Send size={18} /> {sending ? 'Saving…' : 'Send handover'}</button></section><aside><div className="side-card next-caregiver"><span className="eyebrow">NEXT CAREGIVER</span><div className="caregiver-chip large"><div className="avatar avatar-james">JW</div><span><strong>Care team</strong><small>Next scheduled shift</small></span></div><p>The assigned care team can retrieve this handover from the API.</p></div><div className="side-card past-reports"><div className="subsection-heading"><h3>Care records</h3></div><button><FileText /><span><strong>Server-backed handovers</strong><small>Available to assigned caregivers</small></span><ChevronRight /></button></div></aside></div></>
}

function Messages({ notify }: { notify: (message: string) => void }) {
  const [message, setMessage] = useState('')
  const send = () => { if (message.trim()) { setMessage(''); notify('Message sent to Layla') } }
  return <><PageHeader eyebrow="CARE CIRCLE" title="Messages" description="Keep Hassan's family and care team close." /><section className="main-card messages-layout"><aside className="conversation-list"><div className="search-field"><Search /><input placeholder="Search conversations" /></div><button className="active"><div className="avatar avatar-layla">LA</div><span><strong>Layla Abbasi</strong><p>How did Dad sleep last night?</p></span><time>5m</time></button><button><div className="avatar avatar-james">JW</div><span><strong>James Wilson</strong><p>I'll be there a little before 3.</p></span><time>1h</time></button><button><div className="avatar avatar-doctor">DR</div><span><strong>Dr. Rahimi</strong><p>His readings look stable.</p></span><time>Tue</time></button></aside><div className="chat"><header><div className="avatar avatar-layla">LA</div><span><strong>Layla Abbasi</strong><small><i /> Online · Hassan's daughter</small></span><button><MoreHorizontal /></button></header><div className="chat-body"><span className="chat-date">TODAY</span><div className="bubble incoming">Good morning, Sarah. How did Dad sleep last night?<time>09:18</time></div><div className="bubble outgoing">Good morning! He slept well — almost seven hours. He's had breakfast and is in a cheerful mood today.<time>09:21 · Read</time></div><div className="bubble incoming">That's wonderful. Thank you for letting me know ❤️<time>09:22</time></div></div><div className="message-compose"><button><Plus /></button><input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Write a message..." /><button className="send-button" onClick={send}><Send /></button></div></div></section></>
}

function SettingsView({ user, onSignOut, notify }: { user: ApiUser; onSignOut: () => void; notify: (message: string) => void }) {
  return <><PageHeader eyebrow="YOUR WORKSPACE" title="Settings" description="Preferences, access, and notifications." /><div className="settings-layout"><section className="main-card settings-card"><h3>Profile</h3><div className="profile-settings"><div className="avatar avatar-sarah large-avatar">{initials(user.display_name)}</div><div><strong>{user.display_name}</strong><span>{user.role.toLowerCase()} · {user.email}</span><button>Account #{user.id}</button></div></div><hr /><h3>Notifications</h3><SettingToggle title="Task reminders" detail="Alert me 10 minutes before scheduled care." checked /><SettingToggle title="Overdue alerts" detail="Notify me immediately when a task is missed." checked /><SettingToggle title="Family messages" detail="Show alerts for new family messages." checked /><hr /><h3>Security</h3><button className="settings-row"><ShieldCheck /><span><strong>Authenticated session</strong><small>Protected by your Haven API token</small></span><ChevronRight /></button><button className="settings-row" onClick={() => notify('Privacy settings opened')}><UserRound /><span><strong>Privacy & permissions</strong><small>Patient data is limited by active assignments</small></span><ChevronRight /></button></section><aside className="side-card signout-card"><LogOut /><h3>End your session</h3><p>Sign out safely when your shift is complete or you leave this device.</p><button className="danger-button" onClick={onSignOut}>Sign out</button></aside></div></>
}

function SettingToggle({ title, detail, checked }: { title: string; detail: string; checked?: boolean }) {
  const [on, setOn] = useState(Boolean(checked))
  return <button className="toggle-row" onClick={() => setOn(!on)}><span><strong>{title}</strong><small>{detail}</small></span><i className={on ? 'on' : ''}><b /></i></button>
}

function TaskIcon({ task, large = false }: { task: CareTask; large?: boolean }) {
  const Icon = categoryIcons[task.category]
  return <span className={`task-icon ${task.category} ${large ? 'large' : ''}`}><Icon /></span>
}

function TaskRow({ task, onClick }: { task: CareTask; onClick: () => void }) {
  return <button className="task-row" onClick={onClick}><time>{task.time}</time><TaskIcon task={task} /><span><strong>{task.title}</strong><small>{task.detail}</small></span><ChevronRight /></button>
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Close dialog" /><section className="modal"><button className="modal-close" onClick={onClose}><X /></button>{children}</section></div>
}

function TaskModal({ task, onClose, onComplete, notify }: { task: CareTask; onClose: () => void; onComplete: () => void; notify: (message: string) => void }) {
  return <Modal onClose={onClose}><div className="modal-task-head"><TaskIcon task={task} large /><span className="eyebrow">{task.category.toUpperCase()}</span><h2>{task.title}</h2><p>{task.detail}</p></div><div className="detail-grid"><div><small>SCHEDULED TIME</small><strong><Clock3 />{task.time}</strong></div><div><small>STATUS</small><strong className={`text-${task.status}`}>{task.status}</strong></div></div><div className="instruction-box"><span>CARE INSTRUCTIONS</span><p>{task.instructions || 'Follow the care plan and record any relevant observations.'}</p></div><div className="history-row"><span><CheckCircle2 /> Yesterday</span><b>Completed at {task.time}</b></div><div className="modal-actions">{task.status !== 'done' && <button className="complete-button" onClick={onComplete}><Check /> Mark as done</button>}<button className="secondary-button" onClick={() => notify('Problem report started')}><AlertCircle /> Report a problem</button></div></Modal>
}

function AddTaskModal({ onClose, onAdd }: { onClose: () => void; onAdd: (task: Omit<CareTask, 'id' | 'status'>) => void }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<CareTask['category']>('care')
  const [time, setTime] = useState('12:00')
  const submit = (event: FormEvent) => { event.preventDefault(); if (title.trim()) onAdd({ title, time, category, detail: 'Daily care activity', instructions: 'Follow the documented care plan.' }) }
  return <Modal onClose={onClose}><span className="eyebrow">NEW CARE ACTIVITY</span><h2>Create a task</h2><p className="modal-intro">Add a clear, scheduled action to Hassan's care plan.</p><form className="task-form" onSubmit={submit}><label>Task name<input autoFocus required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Change bed linens" /></label><div className="form-row"><label>Category<select value={category} onChange={e => setCategory(e.target.value as CareTask['category'])}><option value="care">Personal care</option><option value="medication">Medication</option><option value="health">Health check</option><option value="meal">Meal</option><option value="activity">Activity</option></select></label><label>Time<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label></div><label>Repeat<select defaultValue="daily"><option value="once">One time</option><option value="daily">Every day</option><option value="weekly">Every week</option></select></label><button className="primary-button">Create task</button></form></Modal>
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
