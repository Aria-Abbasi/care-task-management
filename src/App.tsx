import { CSSProperties, FormEvent, ReactNode, useState } from 'react'
import {
  Activity, AlertCircle, ArrowLeft, Bell, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronRight, ClipboardCheck, Clock3, HeartPulse, Home,
  LogOut, Menu, MessageCircle, MoreHorizontal, Plus, Search, Settings,
  ShieldCheck, Sparkles, Stethoscope, Sun, Thermometer, UserRound,
  Weight, X, Pill, Footprints, Utensils, Send, FileText,
} from 'lucide-react'

type View = 'today' | 'schedule' | 'tasks' | 'medications' | 'health' | 'reports' | 'messages' | 'settings'
type TaskStatus = 'done' | 'overdue' | 'now' | 'upcoming'

type CareTask = {
  id: number
  time: string
  title: string
  detail: string
  category: 'medication' | 'health' | 'meal' | 'activity' | 'care'
  status: TaskStatus
  instructions?: string
}

const initialTasks: CareTask[] = [
  { id: 1, time: '08:00', title: 'Morning medication', detail: 'Amlodipine · 5 mg', category: 'medication', status: 'now', instructions: 'Give after breakfast with a full glass of water.' },
  { id: 2, time: '09:30', title: 'Blood pressure check', detail: '15 minutes overdue', category: 'health', status: 'overdue', instructions: 'Seat Hassan comfortably and rest for 5 minutes before measuring.' },
  { id: 3, time: '07:30', title: 'Breakfast', detail: 'Oatmeal & berries', category: 'meal', status: 'done' },
  { id: 4, time: '10:15', title: 'Morning bath', detail: 'Completed by Sarah', category: 'care', status: 'done' },
  { id: 5, time: '12:30', title: 'Lunch', detail: 'Low-sodium meal', category: 'meal', status: 'upcoming' },
  { id: 6, time: '14:00', title: 'Afternoon walk', detail: '20 minutes · garden route', category: 'activity', status: 'upcoming' },
  { id: 7, time: '16:00', title: 'Metformin', detail: '500 mg · after meal', category: 'medication', status: 'upcoming' },
  { id: 8, time: '20:00', title: 'Evening medication', detail: 'Amlodipine · 5 mg', category: 'medication', status: 'upcoming' },
]

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
  const [signedIn, setSignedIn] = useState(false)
  const [view, setView] = useState<View>('today')
  const [tasks, setTasks] = useState(initialTasks)
  const [selectedTask, setSelectedTask] = useState<CareTask | null>(null)
  const [showAddTask, setShowAddTask] = useState(false)
  const [toast, setToast] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const completeTask = (task: CareTask) => {
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'done' } : item))
    setSelectedTask(null)
    notify(`${task.title} marked complete`)
  }

  const addTask = (task: Omit<CareTask, 'id' | 'status'>) => {
    setTasks((current) => [...current, { ...task, id: Date.now(), status: 'upcoming' }])
    setShowAddTask(false)
    notify('New task added to today')
  }

  if (!signedIn) return <Login onLogin={() => setSignedIn(true)} />

  const activeLabel = navigation.find((item) => item.id === view)?.label

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="brand"><BrandMark /><span>haven</span></div>
        <button className="mobile-close" onClick={() => setMobileMenu(false)} aria-label="Close menu"><X /></button>
        <div className="patient-mini">
          <div className="avatar avatar-hassan">HA</div>
          <div><strong>Hassan Abbasi</strong><span>Primary patient</span></div>
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
          <div className="avatar avatar-sarah">SA</div>
          <div><strong>Sarah James</strong><span>Caregiver</span></div>
          <MoreHorizontal size={19} />
        </div>
      </aside>

      {mobileMenu && <button className="backdrop" onClick={() => setMobileMenu(false)} aria-label="Close menu" />}

      <main>
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" onClick={() => setMobileMenu(true)} aria-label="Open menu"><Menu /></button>
            <div><span className="mobile-page-title">{activeLabel}</span><span className="breadcrumb">Hassan's care <ChevronRight size={13} /> {activeLabel}</span></div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button search-button" aria-label="Search"><Search size={19} /></button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={19} /><i /></button>
            <div className="avatar avatar-sarah top-avatar">SA</div>
          </div>
        </header>

        <div className="content">
          {view === 'today' && <Dashboard tasks={tasks} onTask={setSelectedTask} onComplete={completeTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'schedule' && <Schedule tasks={tasks} onTask={setSelectedTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'tasks' && <Tasks tasks={tasks} onTask={setSelectedTask} onAdd={() => setShowAddTask(true)} />}
          {view === 'medications' && <Medications notify={notify} />}
          {view === 'health' && <Health notify={notify} />}
          {view === 'reports' && <Reports notify={notify} />}
          {view === 'messages' && <Messages notify={notify} />}
          {view === 'settings' && <SettingsView onSignOut={() => setSignedIn(false)} notify={notify} />}
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
      {toast && <div className="toast"><CheckCircle2 size={19} />{toast}</div>}
    </div>
  )
}

function BrandMark() {
  return <span className="brand-mark"><HeartPulse size={20} strokeWidth={2.5} /></span>
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [showPassword, setShowPassword] = useState(false)
  const submit = (event: FormEvent) => { event.preventDefault(); onLogin() }
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
          <label>Phone number or email<input defaultValue="sarah@havencare.com" type="text" autoComplete="username" /></label>
          <label>Password<div className="password-field"><input defaultValue="caregiver" type={showPassword ? 'text' : 'password'} autoComplete="current-password" /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
          <div className="login-options"><label className="checkbox"><input type="checkbox" defaultChecked /><span>Keep me signed in</span></label><button type="button">Forgot password?</button></div>
          <button className="primary-button login-button">Sign in securely <ChevronRight size={18} /></button>
          <div className="secure-note"><ShieldCheck size={16} /> Protected health information is encrypted and secure.</div>
        </form>
      </section>
    </div>
  )
}

function Dashboard({ tasks, onTask, onComplete, onAdd }: { tasks: CareTask[]; onTask: (task: CareTask) => void; onComplete: (task: CareTask) => void; onAdd: () => void }) {
  const complete = tasks.filter((task) => task.status === 'done').length
  const now = tasks.find((task) => task.status === 'now')
  const overdue = tasks.find((task) => task.status === 'overdue')
  const upcoming = tasks.filter((task) => task.status === 'upcoming').slice(0, 3)
  const progress = Math.round((complete / tasks.length) * 100)
  return (
    <>
      <section className="welcome-row">
        <div><span className="eyebrow">THURSDAY · 16 JULY</span><h1>Good morning, Sarah</h1><p>Here's what Hassan needs today.</p></div>
        <button className="primary-button" onClick={onAdd}><Plus size={19} /> Add task</button>
      </section>

      <section className="patient-hero">
        <div className="patient-identity"><div className="avatar avatar-hassan hero-avatar">HA<span /></div><div><span className="status-label"><i /> Stable today</span><h2>Hassan Abbasi</h2><p>82 years old · Room 204</p></div></div>
        <div className="hero-stats">
          <div><HeartPulse /><span><small>Blood pressure</small><strong>120/80 <em>mmHg</em></strong></span><b>Normal</b></div>
          <div><Activity /><span><small>Oxygen</small><strong>97<em>%</em></strong></span><b>Good</b></div>
          <div><Thermometer /><span><small>Temperature</small><strong>36.7<em>°C</em></strong></span><b>Normal</b></div>
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
          <div className="up-next"><div className="subsection-heading"><h3>Up next</h3><button>View schedule <ChevronRight size={16} /></button></div>{upcoming.map((task) => <TaskRow key={task.id} task={task} onClick={() => onTask(task)} />)}</div>
        </section>

        <aside className="dashboard-side">
          <div className="side-card shift-overview"><div className="subsection-heading"><h3>Shift overview</h3><button><MoreHorizontal /></button></div><div className="big-progress"><span>{complete}</span><small>of {tasks.length}<br />complete</small></div><div className="linear-progress"><i style={{ width: `${progress}%` }} /></div><div className="overview-legend"><span><i className="green" />{complete} complete</span><span><i className="amber" />{tasks.length - complete - 1} upcoming</span><span><i className="red" />1 overdue</span></div></div>
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

function Medications({ notify }: { notify: (message: string) => void }) {
  const meds = [{ name: 'Amlodipine', dose: '5 mg', schedule: '08:00 and 20:00', remaining: 18, color: 'coral' }, { name: 'Metformin', dose: '500 mg', schedule: 'After meals', remaining: 32, color: 'teal' }, { name: 'Atorvastatin', dose: '20 mg', schedule: '21:00', remaining: 12, color: 'gold' }]
  return <><PageHeader eyebrow="MEDICATION SAFETY" title="Medications" description="Doses, schedules, and adherence in one place." action={<button className="primary-button" onClick={() => notify('Medication form ready')}><Plus size={19} /> Add medication</button>} /><div className="medication-summary"><div><Pill /><span><small>Today's doses</small><strong>2 of 4 given</strong></span></div><div><ShieldCheck /><span><small>Adherence</small><strong>98% this month</strong></span></div><div><AlertCircle /><span><small>Needs attention</small><strong>1 refill soon</strong></span></div></div><section className="cards-grid">{meds.map(med => <article className="med-card" key={med.name}><div className={`medicine-visual ${med.color}`}><Pill /></div><button className="more-button"><MoreHorizontal /></button><span className="eyebrow">ACTIVE MEDICATION</span><h3>{med.name}</h3><strong>{med.dose}</strong><div className="med-details"><span><Clock3 />{med.schedule}</span><span><ClipboardCheck />Take with food</span></div><div className="stock-row"><span>{med.remaining} doses remaining</span><div><i style={{ width: `${med.remaining * 2.5}%` }} /></div></div><button className="secondary-button" onClick={() => notify(`${med.name} details opened`)}>View medication <ChevronRight /></button></article>)}</section></>
}

function Health({ notify }: { notify: (message: string) => void }) {
  return <><PageHeader eyebrow="HEALTH OVERVIEW" title="Hassan's health" description="Vitals and trends, without the noise." action={<button className="primary-button" onClick={() => notify('New reading saved')}><Plus size={19} /> Record vital</button>} /><div className="health-grid"><section className="main-card bp-chart"><div className="chart-title"><div><span className="icon-box rose"><HeartPulse /></span><span><small>BLOOD PRESSURE</small><h3>120/80 <em>mmHg</em></h3></span></div><b className="normal-badge">Within range</b></div><div className="chart-tabs"><button className="active">7 days</button><button>30 days</button><button>3 months</button></div><svg viewBox="0 0 700 230" role="img" aria-label="Blood pressure trend"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3e8d7d" stopOpacity=".22"/><stop offset="1" stopColor="#3e8d7d" stopOpacity="0"/></linearGradient></defs>{[35,85,135,185].map(y => <line key={y} x1="35" y1={y} x2="680" y2={y} className="grid-line" />)}<path d="M40,110 C95,95 115,124 150,102 S218,75 260,90 S330,112 365,94 S430,65 470,84 S535,108 570,92 S630,74 675,82 L675,210 L40,210Z" fill="url(#area)"/><path d="M40,110 C95,95 115,124 150,102 S218,75 260,90 S330,112 365,94 S430,65 470,84 S535,108 570,92 S630,74 675,82" className="chart-line systolic"/><path d="M40,158 C92,150 120,168 150,154 S216,140 260,149 S325,163 365,151 S430,135 470,145 S535,159 570,148 S635,139 675,143" className="chart-line diastolic"/>{[40,150,260,365,470,570,675].map((x,i) => <text key={x} x={x} y="226" textAnchor="middle">{['Fri','Sat','Sun','Mon','Tue','Wed','Today'][i]}</text>)}</svg><div className="chart-legend"><span><i className="systolic" />Systolic</span><span><i className="diastolic" />Diastolic</span><small>Last recorded today at 09:42</small></div></section><div className="vital-cards"><VitalCard icon={<Activity />} label="Oxygen saturation" value="97" unit="%" note="Good" trend="Stable this week" color="blue" /><VitalCard icon={<Weight />} label="Weight" value="72.4" unit="kg" note="On target" trend="−0.3 kg this month" color="gold" /><VitalCard icon={<Thermometer />} label="Temperature" value="36.7" unit="°C" note="Normal" trend="Recorded at 07:12" color="rose" /></div></div><section className="main-card recent-readings"><div className="subsection-heading"><h3>Recent readings</h3><button>View all <ChevronRight /></button></div><div className="reading-row"><span>Today, 09:42</span><strong>Blood pressure</strong><b>120/80 mmHg</b><em className="normal-badge">Normal</em><span>Sarah James</span></div><div className="reading-row"><span>Today, 07:12</span><strong>Temperature</strong><b>36.7 °C</b><em className="normal-badge">Normal</em><span>Sarah James</span></div></section></>
}

function VitalCard({ icon, label, value, unit, note, trend, color }: { icon: ReactNode; label: string; value: string; unit: string; note: string; trend: string; color: string }) {
  return <article className="vital-card"><div className={`icon-box ${color}`}>{icon}</div><small>{label}</small><h3>{value}<em>{unit}</em></h3><b className="normal-badge">{note}</b><p>{trend}</p></article>
}

function Reports({ notify }: { notify: (message: string) => void }) {
  return <><PageHeader eyebrow="CARE CONTINUITY" title="Reports & handovers" description="Leave the next caregiver with the full picture." /><div className="reports-grid"><section className="main-card report-composer"><span className="eyebrow"><Sun size={16} /> MORNING SHIFT · TODAY</span><h2>Shift handover</h2><p>Summarize Hassan's day for James, who starts at 15:00.</p><div className="report-stats"><div><CheckCircle2 /><strong>3</strong><span>Tasks complete</span></div><div><AlertCircle /><strong>1</strong><span>Issue reported</span></div><div><HeartPulse /><strong>3</strong><span>Vitals recorded</span></div></div><label>Observations<textarea defaultValue="Hassan was in good spirits this morning. He ate most of his breakfast and slept well overnight." /></label><label>Concerns or follow-up<textarea placeholder="Add anything the next caregiver should watch..." /></label><button className="primary-button" onClick={() => notify('Shift report sent to James')}><Send size={18} /> Send to James</button></section><aside><div className="side-card next-caregiver"><span className="eyebrow">NEXT CAREGIVER</span><div className="caregiver-chip large"><div className="avatar avatar-james">JW</div><span><strong>James Wilson</strong><small>Evening shift · 15:00–23:00</small></span></div><p>James will be notified when your handover is ready.</p></div><div className="side-card past-reports"><div className="subsection-heading"><h3>Past reports</h3><button>View all</button></div>{['Yesterday · Evening shift','15 July · Morning shift','14 July · Evening shift'].map((item, index) => <button key={item}><FileText /><span><strong>{item}</strong><small>By {index === 1 ? 'Sarah James' : 'James Wilson'}</small></span><ChevronRight /></button>)}</div></aside></div></>
}

function Messages({ notify }: { notify: (message: string) => void }) {
  const [message, setMessage] = useState('')
  const send = () => { if (message.trim()) { setMessage(''); notify('Message sent to Layla') } }
  return <><PageHeader eyebrow="CARE CIRCLE" title="Messages" description="Keep Hassan's family and care team close." /><section className="main-card messages-layout"><aside className="conversation-list"><div className="search-field"><Search /><input placeholder="Search conversations" /></div><button className="active"><div className="avatar avatar-layla">LA</div><span><strong>Layla Abbasi</strong><p>How did Dad sleep last night?</p></span><time>5m</time></button><button><div className="avatar avatar-james">JW</div><span><strong>James Wilson</strong><p>I'll be there a little before 3.</p></span><time>1h</time></button><button><div className="avatar avatar-doctor">DR</div><span><strong>Dr. Rahimi</strong><p>His readings look stable.</p></span><time>Tue</time></button></aside><div className="chat"><header><div className="avatar avatar-layla">LA</div><span><strong>Layla Abbasi</strong><small><i /> Online · Hassan's daughter</small></span><button><MoreHorizontal /></button></header><div className="chat-body"><span className="chat-date">TODAY</span><div className="bubble incoming">Good morning, Sarah. How did Dad sleep last night?<time>09:18</time></div><div className="bubble outgoing">Good morning! He slept well — almost seven hours. He's had breakfast and is in a cheerful mood today.<time>09:21 · Read</time></div><div className="bubble incoming">That's wonderful. Thank you for letting me know ❤️<time>09:22</time></div></div><div className="message-compose"><button><Plus /></button><input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Write a message..." /><button className="send-button" onClick={send}><Send /></button></div></div></section></>
}

function SettingsView({ onSignOut, notify }: { onSignOut: () => void; notify: (message: string) => void }) {
  return <><PageHeader eyebrow="YOUR WORKSPACE" title="Settings" description="Preferences, access, and notifications." /><div className="settings-layout"><section className="main-card settings-card"><h3>Profile</h3><div className="profile-settings"><div className="avatar avatar-sarah large-avatar">SA</div><div><strong>Sarah James</strong><span>Caregiver · Morning shift</span><button>Change photo</button></div></div><hr /><h3>Notifications</h3><SettingToggle title="Task reminders" detail="Alert me 10 minutes before scheduled care." checked /><SettingToggle title="Overdue alerts" detail="Notify me immediately when a task is missed." checked /><SettingToggle title="Family messages" detail="Show alerts for new family messages." checked /><hr /><h3>Security</h3><button className="settings-row"><ShieldCheck /><span><strong>Password & security</strong><small>Last changed 3 months ago</small></span><ChevronRight /></button><button className="settings-row" onClick={() => notify('Privacy settings opened')}><UserRound /><span><strong>Privacy & permissions</strong><small>Manage access to patient information</small></span><ChevronRight /></button></section><aside className="side-card signout-card"><LogOut /><h3>End your session</h3><p>Sign out safely when your shift is complete or you leave this device.</p><button className="danger-button" onClick={onSignOut}>Sign out</button></aside></div></>
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

export default App
