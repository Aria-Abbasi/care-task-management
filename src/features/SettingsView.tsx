import { useCallback, useEffect, useState } from 'react'
import { Bell, CalendarDays, Check, Clock3, Globe2, KeyRound, Languages, LogOut, MonitorSmartphone, ShieldCheck, Smartphone, Sparkles, Trash2, UserRound } from 'lucide-react'

import { changePassword, confirmMfa, disableMfa, disablePushSubscription, enableWebPush, getNotificationPreference, getPushSubscriptions, getSessions, revokeOtherSessions, revokeSession, setupMfa, updateNotificationPreference, updateProfile } from '../lib/api'
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
    notifications: 'Care notifications', notificationsDetail: 'Choose how critical care updates reach this device.', enablePush: 'Enable Web Push', activate: 'Enable', pushDetail: 'Receive alerts even when Haven is closed.', pushEnabled: 'Background Web Push is enabled on this device', pushDisabled: 'Push disabled for this browser subscription', pushFailed: 'Push setup failed',
    sms: 'SMS escalation', smsDetail: 'Allow critical missed-care escalation by text.', voice: 'Phone escalation', voiceDetail: 'Allow critical escalation by automated call.', quietOverride: 'Critical quiet-hours override', quietOverrideDetail: 'Critical medication alerts can break quiet hours.', quietStart: 'Quiet hours start', quietEnd: 'Quiet hours end', notificationSaved: 'Notification preferences saved',
    security: 'Security', securityDetail: 'Protect this account with an authenticator and trusted devices.', mfa: 'Multi-factor authentication', mfaOn: 'MFA is enabled for this account.', mfaSetUp: 'Set up authenticator MFA', mfaSetUpDetail: 'Require a rotating code when you sign in.', mfaKey: 'Or enter this setup key manually:', mfaScan: 'Scan this QR code with your authenticator app', mfaQrUnavailable: 'QR code unavailable — enter the setup key manually.', verificationCode: 'Six-digit verification code', currentCode: 'Current six-digit code', enableMfa: 'Verify and enable', disableMfa: 'Disable MFA', mfaEnabled: 'Multi-factor authentication enabled', mfaDisabled: 'Multi-factor authentication disabled', changePassword: 'Change password', changePasswordDetail: 'Use your current password to securely set a new one. Other devices will be signed out.', currentPassword: 'Current password', newPassword: 'New password', confirmPassword: 'Confirm new password', passwordChanged: 'Password changed. Other devices were signed out.',
    devices: 'Active devices', revokeOthers: 'Sign out other devices', revoked: 'other sessions revoked', thisDevice: 'This device', activeUntil: 'Active · expires', inactive: 'Revoked or expired', revoke: 'Revoke', sessionCount: 'active sessions', lastActive: 'Last active', deviceProtection: 'Review devices you no longer recognize and revoke access immediately.',
    privacy: 'Offline privacy', eraseOffline: 'Erase offline data', eraseOfflineDetail: 'Remove care records saved on this device. This cannot be undone.', eraseConfirm: 'Tap again to permanently erase offline data', localOnly: 'Stored only on this device', erased: 'Offline care data removed from this device', signOut: 'Sign out', signOutDetail: 'End this session on the current device.', loadError: 'Some settings could not be loaded', browserPush: 'Browser push', enabled: 'Enabled', disabled: 'Disabled', added: 'added', independent: 'Independent care', expires: 'Session expires', browserSession: 'Browser session',
  },
  fa: {
    eyebrow: 'فضای کاری شخصی', title: 'تنظیمات', description: 'فضای کاری مراقبت را برای هر شیفت، آرام‌تر و ایمن‌تر تنظیم کنید.',
    profile: 'پروفایل شما', profileDetail: 'اطلاعات تماس را برای تحویل شیفت و تیم مراقبت به‌روز نگه دارید.', saveProfile: 'ذخیره تغییرات', saved: 'پروفایل ذخیره شد',
    preferences: 'تنظیمات فضای کاری', preferencesDetail: 'زبان، جهت نوشتار و تقویم در این دستگاه حفظ می‌شوند.',
    language: 'زبان و تقویم', languageDetail: 'نحوه نمایش تاریخ‌ها و محیط مراقبت را انتخاب کنید.',
    english: 'English', englishDetail: 'Gregorian calendar · left-to-right', persian: 'فارسی', persianDetail: 'تقویم جلالی · راست‌به‌چپ',
    active: 'فعال', calendar: 'پیش‌نمایش تقویم', gregorian: 'تقویم میلادی', jalali: 'تقویم جلالی',
    notifications: 'اعلان‌های مراقبت', notificationsDetail: 'روش دریافت اطلاع‌رسانی‌های ضروری در این دستگاه را انتخاب کنید.', enablePush: 'فعال‌سازی اعلان پس‌زمینه', activate: 'فعال‌سازی', pushDetail: 'حتی وقتی Haven بسته است، هشدارها را دریافت کنید.', pushEnabled: 'اعلان پس‌زمینه در این دستگاه فعال شد', pushDisabled: 'اعلان این مرورگر غیرفعال شد', pushFailed: 'راه‌اندازی اعلان ناموفق بود',
    sms: 'تشدید از طریق پیامک', smsDetail: 'برای مراقبت‌های از دست‌رفته و ضروری پیامک ارسال شود.', voice: 'تشدید از طریق تماس', voiceDetail: 'برای موارد ضروری تماس خودکار برقرار شود.', quietOverride: 'استثنا برای ساعات سکوت', quietOverrideDetail: 'هشدارهای دارویی ضروری می‌توانند ساعات سکوت را رد کنند.', quietStart: 'شروع ساعات سکوت', quietEnd: 'پایان ساعات سکوت', notificationSaved: 'تنظیمات اعلان ذخیره شد',
    security: 'امنیت', securityDetail: 'از حساب با برنامه احراز هویت و دستگاه‌های مورد اعتماد محافظت کنید.', mfa: 'احراز هویت دومرحله‌ای', mfaOn: 'احراز هویت دومرحله‌ای برای این حساب فعال است.', mfaSetUp: 'راه‌اندازی برنامه احراز هویت', mfaSetUpDetail: 'هنگام ورود، کد یک‌بارمصرف درخواست شود.', mfaKey: 'یا این کلید را دستی وارد کنید:', mfaScan: 'این کد QR را با برنامه احراز هویت اسکن کنید', mfaQrUnavailable: 'کد QR در دسترس نیست؛ کلید راه‌اندازی را دستی وارد کنید.', verificationCode: 'کد تأیید شش‌رقمی', currentCode: 'کد فعلی شش‌رقمی', enableMfa: 'تأیید و فعال‌سازی', disableMfa: 'غیرفعال‌سازی MFA', mfaEnabled: 'احراز هویت دومرحله‌ای فعال شد', mfaDisabled: 'احراز هویت دومرحله‌ای غیرفعال شد', changePassword: 'تغییر گذرواژه', changePasswordDetail: 'با گذرواژه فعلی، گذرواژه جدیدی تنظیم کنید. سایر دستگاه‌ها خارج می‌شوند.', currentPassword: 'گذرواژه فعلی', newPassword: 'گذرواژه جدید', confirmPassword: 'تأیید گذرواژه جدید', passwordChanged: 'گذرواژه تغییر کرد و سایر دستگاه‌ها خارج شدند.',
    devices: 'دستگاه‌های فعال', revokeOthers: 'خروج از دستگاه‌های دیگر', revoked: 'نشست دیگر لغو شد', thisDevice: 'این دستگاه', activeUntil: 'فعال · پایان', inactive: 'لغو شده یا منقضی', revoke: 'لغو', sessionCount: 'نشست فعال', lastActive: 'آخرین فعالیت', deviceProtection: 'دستگاه‌های ناشناس را بررسی کرده و دسترسی آن‌ها را فوراً لغو کنید.',
    privacy: 'حریم خصوصی آفلاین', eraseOffline: 'پاک‌سازی اطلاعات آفلاین', eraseOfflineDetail: 'سوابق مراقبت ذخیره‌شده در این دستگاه حذف می‌شود و قابل بازگشت نیست.', eraseConfirm: 'برای حذف همیشگی اطلاعات آفلاین، دوباره بزنید', localOnly: 'فقط در همین دستگاه نگه‌داری می‌شود', erased: 'اطلاعات آفلاین این دستگاه پاک شد', signOut: 'خروج از حساب', signOutDetail: 'نشست فعلی را در این دستگاه پایان دهید.', loadError: 'برخی از تنظیمات بارگذاری نشدند', browserPush: 'اعلان مرورگر', enabled: 'فعال', disabled: 'غیرفعال', added: 'افزوده شده', independent: 'مراقبت مستقل', expires: 'پایان نشست', browserSession: 'نشست مرورگر',
  },
} as const

export default function SettingsView({ session, onSignOut, notify, locale, onLocale }: { session: Session; onSignOut: () => void; notify: (message: string) => void; locale: string; onLocale: (value: string) => void }) {
  const isPersian = locale === 'fa'
  const text = copy[isPersian ? 'fa' : 'en']
  const dateLocale = isPersian ? 'fa-IR-u-ca-persian' : 'en-GB'
  const [preference, setPreference] = useState<NotificationPreference | null>(null)
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [subscriptions, setSubscriptions] = useState<PushSubscription[]>([])
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; qr_code_data_url?: string } | null>(null)
  const [mfaQrFailed, setMfaQrFailed] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaEnabled, setMfaEnabled] = useState(session.user.mfa_enabled)
  const [disableCode, setDisableCode] = useState('')
  const [profile, setProfile] = useState({ first_name: session.user.first_name, last_name: session.user.last_name, email: session.user.email, phone: session.user.phone || '' })
  const [password, setPassword] = useState({ current: '', next: '', confirmation: '' })
  const [changingPassword, setChangingPassword] = useState(false)
  const [eraseReady, setEraseReady] = useState(false)
  const activeSessions = sessions.filter((item) => item.active).slice(0, 6)
  const pushEnabled = subscriptions.some((item) => item.active)
  const formatDate = (value: string | Date, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }) => new Intl.DateTimeFormat(dateLocale, options).format(new Date(value))
  const load = useCallback(() => Promise.all([getNotificationPreference(session.token), getSessions(session.token), getPushSubscriptions(session.token)]).then(([nextPreference, nextSessions, nextSubscriptions]) => { setPreference(nextPreference); setSessions(nextSessions); setSubscriptions(nextSubscriptions) }), [session.token])

  useEffect(() => { load().catch(() => notify(text.loadError)) }, [load, notify, text.loadError])
  useEffect(() => {
    if (!eraseReady) return
    const timeout = window.setTimeout(() => setEraseReady(false), 6_000)
    return () => window.clearTimeout(timeout)
  }, [eraseReady])
  const patchPreference = async (values: Partial<NotificationPreference>) => { const next = await updateNotificationPreference(session.token, values); setPreference(next); notify(text.notificationSaved) }
  const startMfa = async () => { const result = await setupMfa(session.token); setMfaQrFailed(false); setMfaSetup(result) }
  const finishMfa = async () => { await confirmMfa(session.token, mfaCode); setMfaEnabled(true); setMfaSetup(null); setMfaCode(''); notify(text.mfaEnabled) }
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
          {pushEnabled ? <div className="push-notification-action active"><span className="push-action-icon"><Bell /></span><div><strong>{text.pushEnabled}</strong><small>{text.pushDetail}</small></div><b><Check />{text.enabled}</b></div> : <button className="push-notification-action" onClick={async () => { try { await enableWebPush(session.token); await patchPreference({ push_enabled: true }); await load(); notify(text.pushEnabled) } catch (error) { notify(error instanceof Error ? error.message : text.pushFailed) } }}><span className="push-action-icon"><Bell /></span><div><strong>{text.enablePush}</strong><small>{text.pushDetail}</small></div><span className="push-action-cta">{text.activate}</span></button>}
          {subscriptions.map((item) => <div className="settings-row" key={item.id}><span className="setting-icon muted"><Smartphone /></span><span><strong>{item.device_name || text.browserPush}</strong><small>{item.active ? text.enabled : text.disabled} · {text.added} {formatDate(item.created_at)}</small></span>{item.active && <button className="text-button danger-text" onClick={async () => { await disablePushSubscription(session.token, item.id); if (!subscriptions.some((subscription) => subscription.id !== item.id && subscription.active)) await patchPreference({ push_enabled: false }); await load(); notify(text.pushDisabled) }}>{isPersian ? 'غیرفعال‌سازی' : 'Disable'}</button>}</div>)}
          {preference && <><Toggle title={text.sms} detail={text.smsDetail} checked={preference.sms_enabled} onChange={(sms_enabled) => patchPreference({ sms_enabled })} /><Toggle title={text.voice} detail={text.voiceDetail} checked={preference.voice_enabled} onChange={(voice_enabled) => patchPreference({ voice_enabled })} /><Toggle title={text.quietOverride} detail={text.quietOverrideDetail} checked={preference.critical_override} onChange={(critical_override) => patchPreference({ critical_override })} /><div className="form-row quiet-hours"><label><Clock3 />{text.quietStart}<input dir="ltr" type="time" value={preference.quiet_hours_start?.slice(0, 5) || ''} onChange={(event) => patchPreference({ quiet_hours_start: event.target.value || null })} /></label><label><Clock3 />{text.quietEnd}<input dir="ltr" type="time" value={preference.quiet_hours_end?.slice(0, 5) || ''} onChange={(event) => patchPreference({ quiet_hours_end: event.target.value || null })} /></label></div></>}
        </section>

        <section className="main-card settings-card settings-section">
          <SectionHeading icon={<ShieldCheck />} title={text.security} detail={text.securityDetail} />
          {mfaEnabled ? <><div className="mfa-action-card active"><span className="mfa-action-icon"><KeyRound /></span><div><strong>{text.mfa}</strong><small>{text.mfaOn}</small></div><b><Check />{text.enabled}</b></div><div className="mfa-setup"><label>{text.currentCode}<input dir="ltr" inputMode="numeric" value={disableCode} onChange={(event) => setDisableCode(event.target.value)} /></label><button className="danger-button" disabled={disableCode.length !== 6} onClick={async () => { await disableMfa(session.token, disableCode); setMfaEnabled(false); setDisableCode(''); notify(text.mfaDisabled) }}>{text.disableMfa}</button></div></> : mfaSetup ? <><div className="mfa-action-card setup"><span className="mfa-action-icon"><KeyRound /></span><div><strong>{text.mfaSetUp}</strong><small>{text.mfaScan}</small></div></div><div className="mfa-setup mfa-enrollment">{mfaSetup.qr_code_data_url && !mfaQrFailed ? <img className="mfa-qr-code" src={mfaSetup.qr_code_data_url} alt={text.mfaScan} onError={() => setMfaQrFailed(true)} /> : <div className="mfa-qr-fallback" role="status"><KeyRound /><span>{text.mfaQrUnavailable}</span></div>}<div><p>{text.mfaKey}</p><code dir="ltr">{mfaSetup.secret}</code></div><label>{text.verificationCode}<input dir="ltr" inputMode="numeric" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /></label><button className="primary-button" disabled={mfaCode.length !== 6} onClick={finishMfa}>{text.enableMfa}</button></div></> : <button className="mfa-action-card" onClick={startMfa}><span className="mfa-action-icon"><KeyRound /></span><div><strong>{text.mfaSetUp}</strong><small>{text.mfaSetUpDetail}</small></div><span className="mfa-action-cta">{text.activate}</span></button>}
          <form className="password-change-card" onSubmit={async (event) => { event.preventDefault(); setChangingPassword(true); try { await changePassword(session.token, password.current, password.next, password.confirmation); setPassword({ current: '', next: '', confirmation: '' }); notify(text.passwordChanged) } catch (error) { notify(error instanceof Error ? error.message : text.loadError) } finally { setChangingPassword(false) } }}><span className="password-change-icon"><KeyRound /></span><div className="password-change-heading"><strong>{text.changePassword}</strong><small>{text.changePasswordDetail}</small></div><label>{text.currentPassword}<input type="password" autoComplete="current-password" value={password.current} onChange={(event) => setPassword({ ...password, current: event.target.value })} required /></label><label>{text.newPassword}<input type="password" autoComplete="new-password" minLength={8} value={password.next} onChange={(event) => setPassword({ ...password, next: event.target.value })} required /></label><label>{text.confirmPassword}<input type="password" autoComplete="new-password" minLength={8} value={password.confirmation} onChange={(event) => setPassword({ ...password, confirmation: event.target.value })} required /></label><button className="secondary-button" disabled={changingPassword || password.next !== password.confirmation}>{changingPassword ? (isPersian ? 'در حال ذخیره…' : 'Saving…') : text.changePassword}</button></form>
          <div className="devices-header"><div><h3 className="settings-subtitle"><MonitorSmartphone />{text.devices}</h3><p>{text.deviceProtection}</p></div><button className="text-button" onClick={async () => { const result = await revokeOtherSessions(session.token); await load(); notify(`${result.revoked} ${text.revoked}`) }}>{text.revokeOthers}</button></div>
          <div className="device-session-summary"><ShieldCheck /><strong>{activeSessions.length}</strong><span>{text.sessionCount}</span></div>
          <div className="device-list">{activeSessions.map((item) => <article className="device-row" key={item.id}><span className="device-icon"><MonitorSmartphone /></span><div><div className="device-title"><strong>{deviceLabel(item.device_name || '', text.browserSession, isPersian)}</strong>{item.id === session.session_id && <b>{text.thisDevice}</b>}</div><small>{text.lastActive} · {formatDate(item.last_used_at || item.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small><small>{text.activeUntil} {formatDate(item.expires_at, { dateStyle: 'medium', timeStyle: 'short' })}</small></div>{item.id !== session.session_id && <button className="revoke-device" onClick={async () => { await revokeSession(session.token, item.id); await load() }}>{text.revoke}</button>}</article>)}</div>
        </section>

        <section className="main-card settings-card settings-section privacy-section">
          <SectionHeading icon={<Trash2 />} title={text.privacy} detail={isPersian ? 'اطلاعات حساس آفلاین فقط در همین دستگاه نگه‌داری می‌شود.' : 'Sensitive offline records remain only on this device.'} />
          <div className="offline-privacy-note"><ShieldCheck /><span><strong>{text.localOnly}</strong><small>{text.eraseOfflineDetail}</small></span></div>
          <button className={`erase-offline-action ${eraseReady ? 'confirming' : ''}`} onClick={async () => { if (!eraseReady) { setEraseReady(true); return }; await clearOfflineData(); setEraseReady(false); notify(text.erased) }}><span><Trash2 /></span><div><strong>{eraseReady ? text.eraseConfirm : text.eraseOffline}</strong><small>{eraseReady ? text.eraseOfflineDetail : text.eraseConfirm}</small></div></button>
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
