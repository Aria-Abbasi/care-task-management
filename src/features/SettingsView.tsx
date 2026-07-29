import { useCallback, useEffect, useState } from 'react'
import { Bell, CalendarDays, Check, ChevronRight, Clock3, Globe2, KeyRound, Languages, LogOut, MonitorSmartphone, ShieldCheck, Smartphone, Sparkles, Trash2, UserRound } from 'lucide-react'

import { confirmMfa, disableMfa, disablePushSubscription, enableWebPush, getNotificationPreference, getPushSubscriptions, getSessions, revokeOtherSessions, revokeSession, setupMfa, updateNotificationPreference, updateProfile } from '../lib/api'
import { clearOfflineData } from '../lib/offline'
import type { DeviceSession, NotificationPreference, PushSubscription, Session } from '../lib/types'
import { PageHeader } from '../components/PageHeader'

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() }

function deviceLabel(deviceName: string, fallback: string, isPersian: boolean) {
  const value = deviceName.toLowerCase()
  if (value.includes('iphone') || value.includes('ipad')) return isPersian ? 'مرورگر اپل' : 'Apple browser'
  if (value.includes('android')) return isPersian ? 'مرورگر اندروید' : 'Android browser'
  if (value.includes('windows')) return isPersian ? 'مرورگر ویندوز' : 'Windows browser'
  if (value.includes('mac os') || value.includes('macintosh')) return isPersian ? 'مرورگر مک' : 'Mac browser'
  if (value.includes('linux')) return isPersian ? 'مرورگر لینوکس' : 'Linux browser'
  return deviceName || fallback
}

const copy = {
  en: {
    eyebrow: 'PERSONAL WORKSPACE', title: 'Settings', description: 'Shape a calmer, safer care workspace for every shift.',
    profile: 'Your profile', profileDetail: 'Keep your contact details current for care-team handovers.', saveProfile: 'Save changes', saved: 'Profile saved',
    preferences: 'Workspace preferences', preferencesDetail: 'Language, direction, and calendar stay with this device.',
    language: 'Language & calendar', languageDetail: 'Choose how dates and the care workspace are displayed.',
    english: 'English', englishDetail: 'Gregorian calendar · left-to-right', persian: 'فارسی', persianDetail: 'تقویم جلالی · راست‌به‌چپ',
    active: 'Active', calendar: 'Calendar preview', gregorian: 'Gregorian calendar', jalali: 'Jalali calendar',
    notifications: 'Care notifications', notificationsDetail: 'Choose how critical care updates reach this device.', enablePush: 'Enable Web Push', pushDetail: 'Receive alerts even when Haven is closed.', pushEnabled: 'Background Web Push is enabled on this device', pushDisabled: 'Push disabled for this browser subscription', pushFailed: 'Push setup failed',
    sms: 'SMS escalation', smsDetail: 'Allow critical missed-care escalation by text.', voice: 'Phone escalation', voiceDetail: 'Allow critical escalation by automated call.', quietOverride: 'Critical quiet-hours override', quietOverrideDetail: 'Critical medication alerts can break quiet hours.', quietStart: 'Quiet hours start', quietEnd: 'Quiet hours end', notificationSaved: 'Notification preferences saved',
    security: 'Security', securityDetail: 'Protect this account with an authenticator and trusted devices.', mfa: 'Multi-factor authentication', mfaOn: 'MFA is enabled for this account.', mfaSetUp: 'Set up authenticator MFA', mfaSetUpDetail: 'Require a rotating code when you sign in.', mfaKey: 'Add this setup key to an authenticator app:', verificationCode: 'Six-digit verification code', currentCode: 'Current six-digit code', enableMfa: 'Verify and enable', disableMfa: 'Disable MFA', mfaEnabled: 'Multi-factor authentication enabled', mfaDisabled: 'Multi-factor authentication disabled',
    devices: 'Active devices', revokeOthers: 'Sign out other devices', revoked: 'other sessions revoked', thisDevice: 'This device', activeUntil: 'Active · expires', inactive: 'Revoked or expired', revoke: 'Revoke',
    privacy: 'Offline privacy', eraseOffline: 'Erase offline data', eraseOfflineDetail: 'Remove care records saved on this device. This cannot be undone.', erased: 'Offline care data removed from this device', signOut: 'Sign out', signOutDetail: 'End this session on the current device.', loadError: 'Some settings could not be loaded', browserPush: 'Browser push', enabled: 'Enabled', disabled: 'Disabled', added: 'added', independent: 'Independent care', expires: 'Session expires', browserSession: 'Browser session',
  },
  fa: {
    eyebrow: 'فضای کاری شخصی', title: 'تنظیمات', description: 'فضای کاری مراقبت را برای هر شیفت، آرام‌تر و ایمن‌تر تنظیم کنید.',
    profile: 'پروفایل شما', profileDetail: 'اطلاعات تماس را برای تحویل شیفت و تیم مراقبت به‌روز نگه دارید.', saveProfile: 'ذخیره تغییرات', saved: 'پروفایل ذخیره شد',
    preferences: 'تنظیمات فضای کاری', preferencesDetail: 'زبان، جهت نوشتار و تقویم در این دستگاه حفظ می‌شوند.',
    language: 'زبان و تقویم', languageDetail: 'نحوه نمایش تاریخ‌ها و محیط مراقبت را انتخاب کنید.',
    english: 'English', englishDetail: 'Gregorian calendar · left-to-right', persian: 'فارسی', persianDetail: 'تقویم جلالی · راست‌به‌چپ',
    active: 'فعال', calendar: 'پیش‌نمایش تقویم', gregorian: 'تقویم میلادی', jalali: 'تقویم جلالی',
    notifications: 'اعلان‌های مراقبت', notificationsDetail: 'روش دریافت اطلاع‌رسانی‌های ضروری در این دستگاه را انتخاب کنید.', enablePush: 'فعال‌سازی اعلان پس‌زمینه', pushDetail: 'حتی وقتی Haven بسته است، هشدارها را دریافت کنید.', pushEnabled: 'اعلان پس‌زمینه در این دستگاه فعال شد', pushDisabled: 'اعلان این مرورگر غیرفعال شد', pushFailed: 'راه‌اندازی اعلان ناموفق بود',
    sms: 'تشدید از طریق پیامک', smsDetail: 'برای مراقبت‌های از دست‌رفته و ضروری پیامک ارسال شود.', voice: 'تشدید از طریق تماس', voiceDetail: 'برای موارد ضروری تماس خودکار برقرار شود.', quietOverride: 'استثنا برای ساعات سکوت', quietOverrideDetail: 'هشدارهای دارویی ضروری می‌توانند ساعات سکوت را رد کنند.', quietStart: 'شروع ساعات سکوت', quietEnd: 'پایان ساعات سکوت', notificationSaved: 'تنظیمات اعلان ذخیره شد',
    security: 'امنیت', securityDetail: 'از حساب با برنامه احراز هویت و دستگاه‌های مورد اعتماد محافظت کنید.', mfa: 'احراز هویت دومرحله‌ای', mfaOn: 'احراز هویت دومرحله‌ای برای این حساب فعال است.', mfaSetUp: 'راه‌اندازی برنامه احراز هویت', mfaSetUpDetail: 'هنگام ورود، کد یک‌بارمصرف درخواست شود.', mfaKey: 'این کلید را در برنامه احراز هویت وارد کنید:', verificationCode: 'کد تأیید شش‌رقمی', currentCode: 'کد فعلی شش‌رقمی', enableMfa: 'تأیید و فعال‌سازی', disableMfa: 'غیرفعال‌سازی MFA', mfaEnabled: 'احراز هویت دومرحله‌ای فعال شد', mfaDisabled: 'احراز هویت دومرحله‌ای غیرفعال شد',
    devices: 'دستگاه‌های فعال', revokeOthers: 'خروج از دستگاه‌های دیگر', revoked: 'نشست دیگر لغو شد', thisDevice: 'این دستگاه', activeUntil: 'فعال · پایان', inactive: 'لغو شده یا منقضی', revoke: 'لغو',
    privacy: 'حریم خصوصی آفلاین', eraseOffline: 'پاک‌سازی اطلاعات آفلاین', eraseOfflineDetail: 'سوابق مراقبت ذخیره‌شده در این دستگاه حذف می‌شود و قابل بازگشت نیست.', erased: 'اطلاعات آفلاین این دستگاه پاک شد', signOut: 'خروج از حساب', signOutDetail: 'نشست فعلی را در این دستگاه پایان دهید.', loadError: 'برخی از تنظیمات بارگذاری نشدند', browserPush: 'اعلان مرورگر', enabled: 'فعال', disabled: 'غیرفعال', added: 'افزوده شده', independent: 'مراقبت مستقل', expires: 'پایان نشست', browserSession: 'نشست مرورگر',
  },
} as const

export default function SettingsView({ session, onSignOut, notify, locale, onLocale }: { session: Session; onSignOut: () => void; notify: (message: string) => void; locale: string; onLocale: (value: string) => void }) {
  const isPersian = locale === 'fa'
  const text = copy[isPersian ? 'fa' : 'en']
  const dateLocale = isPersian ? 'fa-IR-u-ca-persian' : 'en-GB'
  const [preference, setPreference] = useState<NotificationPreference | null>(null)
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [subscriptions, setSubscriptions] = useState<PushSubscription[]>([])
  const [mfaSecret, setMfaSecret] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaEnabled, setMfaEnabled] = useState(session.user.mfa_enabled)
  const [disableCode, setDisableCode] = useState('')
  const [profile, setProfile] = useState({ first_name: session.user.first_name, last_name: session.user.last_name, email: session.user.email, phone: session.user.phone || '' })
  const activeSessions = sessions.filter((item) => item.active).slice(0, 6)
  const formatDate = (value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) => new Intl.DateTimeFormat(dateLocale, options).format(new Date(value))
  const load = useCallback(() => Promise.all([getNotificationPreference(session.token), getSessions(session.token), getPushSubscriptions(session.token)]).then(([nextPreference, nextSessions, nextSubscriptions]) => { setPreference(nextPreference); setSessions(nextSessions); setSubscriptions(nextSubscriptions) }), [session.token])

  useEffect(() => { load().catch(() => notify(text.loadError)) }, [load, notify, text.loadError])
  const patchPreference = async (values: Partial<NotificationPreference>) => { const next = await updateNotificationPreference(session.token, values); setPreference(next); notify(text.notificationSaved) }
  const startMfa = async () => { const result = await setupMfa(session.token); setMfaSecret(result.secret) }
  const finishMfa = async () => { await confirmMfa(session.token, mfaCode); setMfaEnabled(true); setMfaSecret(''); setMfaCode(''); notify(text.mfaEnabled) }
  const handleLocale = (value: 'en' | 'fa') => { onLocale(value); notify(value === 'fa' ? 'زبان فارسی و تقویم جلالی فعال شد' : 'English and the Gregorian calendar are active') }

  return <>
    <PageHeader eyebrow={text.eyebrow} title={text.title} description={text.description} />
    <div className="settings-layout settings-layout-refined">
      <section className="settings-main">
        <section className="settings-hero main-card">
          <div className="settings-hero-copy"><span className="settings-hero-icon"><Sparkles /></span><div><span className="eyebrow">{text.preferences}</span><h2>{isPersian ? 'فضایی که با شما هماهنگ است' : 'A workspace that feels like yours'}</h2><p>{text.preferencesDetail}</p></div></div>
          <div className="calendar-preview" aria-label={text.calendar}><CalendarDays /><div><small>{text.calendar}</small><strong>{formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong><span>{isPersian ? text.jalali : text.gregorian}</span></div></div>
        </section>

        <section className="main-card settings-card settings-section">
          <SectionHeading icon={<UserRound />} title={text.profile} detail={text.profileDetail} />
          <div className="profile-settings"><div className="avatar avatar-sarah large-avatar">{initials(session.user.display_name)}</div><div><strong>{session.user.display_name}</strong><span>{session.user.role.toLowerCase()} · {session.user.organization_name || text.independent}</span><small>{text.expires} {formatDate(session.expires_at, { dateStyle: 'medium', timeStyle: 'short' })}</small></div></div>
          <div className="profile-form-row"><label><span>{isPersian ? 'نام' : 'First name'}</span><input value={profile.first_name} onChange={(event) => setProfile({ ...profile, first_name: event.target.value })} /></label><label><span>{isPersian ? 'نام خانوادگی' : 'Last name'}</span><input value={profile.last_name} onChange={(event) => setProfile({ ...profile, last_name: event.target.value })} /></label></div>
          <div className="profile-form-row"><label><span>{isPersian ? 'ایمیل' : 'Email'}</span><input type="email" dir="ltr" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></label><label><span>{isPersian ? 'شماره تلفن' : 'Phone'}</span><input dir="ltr" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label></div>
          <button className="secondary-button" onClick={async () => { await updateProfile(session.token, session.user.id, { ...profile, phone: profile.phone || null }); notify(text.saved) }}><Check />{text.saveProfile}</button>
        </section>

        <section className="main-card settings-card settings-section">
          <SectionHeading icon={<Languages />} title={text.language} detail={text.languageDetail} />
          <div className="locale-picker" role="group" aria-label={text.language}>
            <button className={!isPersian ? 'selected' : ''} aria-pressed={!isPersian} onClick={() => handleLocale('en')}><Globe2 /><span><strong>{text.english}</strong><small>{text.englishDetail}</small></span>{!isPersian && <Check />}</button>
            <button className={isPersian ? 'selected' : ''} aria-pressed={isPersian} onClick={() => handleLocale('fa')}><CalendarDays /><span><strong>{text.persian}</strong><small>{text.persianDetail}</small></span>{isPersian && <Check />}</button>
          </div>
        </section>

        <section className="main-card settings-card settings-section">
          <SectionHeading icon={<Bell />} title={text.notifications} detail={text.notificationsDetail} />
          <button className="settings-row featured-setting" onClick={async () => { try { await enableWebPush(session.token); await patchPreference({ push_enabled: true }); await load(); notify(text.pushEnabled) } catch (error) { notify(error instanceof Error ? error.message : text.pushFailed) } }}><span className="setting-icon"><Bell /></span><span><strong>{text.enablePush}</strong><small>{text.pushDetail}</small></span><ChevronRight /></button>
          {subscriptions.map((item) => <div className="settings-row" key={item.id}><span className="setting-icon muted"><Smartphone /></span><span><strong>{item.device_name || text.browserPush}</strong><small>{item.active ? text.enabled : text.disabled} · {text.added} {formatDate(item.created_at)}</small></span>{item.active && <button className="text-button danger-text" onClick={async () => { await disablePushSubscription(session.token, item.id); if (!subscriptions.some((subscription) => subscription.id !== item.id && subscription.active)) await patchPreference({ push_enabled: false }); await load(); notify(text.pushDisabled) }}>{isPersian ? 'غیرفعال‌سازی' : 'Disable'}</button>}</div>)}
          {preference && <><Toggle title={text.sms} detail={text.smsDetail} checked={preference.sms_enabled} onChange={(sms_enabled) => patchPreference({ sms_enabled })} /><Toggle title={text.voice} detail={text.voiceDetail} checked={preference.voice_enabled} onChange={(voice_enabled) => patchPreference({ voice_enabled })} /><Toggle title={text.quietOverride} detail={text.quietOverrideDetail} checked={preference.critical_override} onChange={(critical_override) => patchPreference({ critical_override })} /><div className="form-row quiet-hours"><label><Clock3 />{text.quietStart}<input dir="ltr" type="time" value={preference.quiet_hours_start?.slice(0, 5) || ''} onChange={(event) => patchPreference({ quiet_hours_start: event.target.value || null })} /></label><label><Clock3 />{text.quietEnd}<input dir="ltr" type="time" value={preference.quiet_hours_end?.slice(0, 5) || ''} onChange={(event) => patchPreference({ quiet_hours_end: event.target.value || null })} /></label></div></>}
        </section>

        <section className="main-card settings-card settings-section">
          <SectionHeading icon={<ShieldCheck />} title={text.security} detail={text.securityDetail} />
          <h3 className="settings-subtitle"><KeyRound />{text.mfa}</h3>
          {mfaEnabled ? <div className="mfa-setup"><div className="secure-note"><ShieldCheck /> {text.mfaOn}</div><label>{text.currentCode}<input dir="ltr" inputMode="numeric" value={disableCode} onChange={(event) => setDisableCode(event.target.value)} /></label><button className="danger-button" disabled={disableCode.length !== 6} onClick={async () => { await disableMfa(session.token, disableCode); setMfaEnabled(false); setDisableCode(''); notify(text.mfaDisabled) }}>{text.disableMfa}</button></div> : mfaSecret ? <div className="mfa-setup"><p>{text.mfaKey}</p><code dir="ltr">{mfaSecret}</code><label>{text.verificationCode}<input dir="ltr" inputMode="numeric" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /></label><button className="primary-button" onClick={finishMfa}>{text.enableMfa}</button></div> : <button className="settings-row" onClick={startMfa}><span className="setting-icon"><KeyRound /></span><span><strong>{text.mfaSetUp}</strong><small>{text.mfaSetUpDetail}</small></span><ChevronRight /></button>}
          <div className="devices-header"><h3 className="settings-subtitle"><MonitorSmartphone />{text.devices}</h3><button className="text-button" onClick={async () => { const result = await revokeOtherSessions(session.token); await load(); notify(`${result.revoked} ${text.revoked}`) }}>{text.revokeOthers}</button></div>
          {activeSessions.map((item) => <div className="settings-row device-row" key={item.id}><span className="setting-icon muted"><MonitorSmartphone /></span><span><strong>{deviceLabel(item.device_name || '', text.browserSession, isPersian)}{item.id === session.session_id ? ` · ${text.thisDevice}` : ''}</strong><small>{`${text.activeUntil} ${formatDate(item.expires_at)}`}</small></span>{item.id !== session.session_id && <button className="text-button danger-text" onClick={async () => { await revokeSession(session.token, item.id); await load() }}>{text.revoke}</button>}</div>)}
        </section>

        <section className="main-card settings-card settings-section privacy-section">
          <SectionHeading icon={<Trash2 />} title={text.privacy} detail={isPersian ? 'اطلاعات حساس آفلاین فقط در همین دستگاه نگه‌داری می‌شود.' : 'Sensitive offline records remain only on this device.'} />
          <button className="settings-row danger-setting" onClick={async () => { await clearOfflineData(); notify(text.erased) }}><span className="setting-icon"><Trash2 /></span><span><strong>{text.eraseOffline}</strong><small>{text.eraseOfflineDetail}</small></span><ChevronRight /></button>
        </section>
      </section>
      <aside className="settings-aside">
        <section className="side-card settings-status-card"><span className="settings-status-icon"><ShieldCheck /></span><span className="eyebrow">{isPersian ? 'وضعیت حساب' : 'ACCOUNT STATUS'}</span><h3>{isPersian ? 'فضای کاری شما محافظت شده است' : 'Your workspace is protected'}</h3><p>{mfaEnabled ? (isPersian ? 'احراز هویت دومرحله‌ای فعال است.' : 'Multi-factor authentication is active.') : (isPersian ? 'برای امنیت بیشتر MFA را فعال کنید.' : 'Set up MFA for stronger protection.')}</p><div><i className={mfaEnabled ? 'on' : ''} />{mfaEnabled ? text.active : (isPersian ? 'نیازمند بررسی' : 'Review recommended')}</div></section>
        <section className="side-card signout-card"><LogOut /><h3>{text.signOut}</h3><p>{text.signOutDetail}</p><button className="danger-button" onClick={onSignOut}>{text.signOut}</button></section>
      </aside>
    </div>
  </>
}

function SectionHeading({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <header className="settings-section-heading"><span>{icon}</span><div><h2>{title}</h2><p>{detail}</p></div></header>
}

function Toggle({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <button className="toggle-row" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><span><strong>{title}</strong><small>{detail}</small></span><i className={checked ? 'on' : ''}><b /></i></button>
}
