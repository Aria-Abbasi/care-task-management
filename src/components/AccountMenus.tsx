import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronRight, Cloud, CloudOff, LogOut, MoreHorizontal, Settings, UserRound } from 'lucide-react'

import type { ApiUser } from '../lib/types'

type AccountCopy = {
  account: string
  settings: string
  switchPatient: string
  signOut: string
  protectedSignOut: string
  more: string
  switchOrg?: string
}

type AccountMenuProps = {
  user: ApiUser
  roleLabel: string
  copy: AccountCopy
  online: boolean
  syncing: boolean
  pendingSync: number
  syncLabel: string
  onSettings: () => void
  onSwitchPatient: () => void
  onSwitchOrg?: (orgId: number) => void
  onSignOut: () => void
}

const initials = (name: string) => name.split(' ').map((item) => item[0]).join('').slice(0, 2)

function useAccountMenu(triggerSelector: string) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeFromOutside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      ref.current?.querySelector<HTMLButtonElement>(triggerSelector)?.focus()
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    const frame = window.requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
      window.cancelAnimationFrame(frame)
    }
  }, [open, triggerSelector])

  return { open, ref, setOpen }
}

export function SidebarAccountMenu({ user, roleLabel, copy, online, pendingSync, onSettings, onSwitchPatient, onSwitchOrg, onSignOut }: AccountMenuProps) {
  const menu = useAccountMenu('.sidebar-profile-more')
  const orgs = user.organizations || []
  return (
    <div className="sidebar-profile" ref={menu.ref}>
      <button className="profile-row" onClick={onSettings}>
        <div className="avatar avatar-sarah">{initials(user.display_name)}</div>
        <div>
          <strong>{user.display_name}</strong>
          <span>{roleLabel} {user.organization_name ? `· ${user.organization_name}` : ''}</span>
        </div>
      </button>
      <button className={`sidebar-profile-more ${menu.open ? 'open' : ''}`} onClick={() => menu.setOpen((current) => !current)} aria-label={copy.more} aria-expanded={menu.open} aria-haspopup="menu" aria-controls="sidebar-account-menu">
        <MoreHorizontal size={19} />
      </button>
      {menu.open && (
        <div id="sidebar-account-menu" className="sidebar-account-menu" role="menu">
          <div className="sidebar-account-head">
            <span className="avatar avatar-sarah">{initials(user.display_name)}</span>
            <span>
              <small>{copy.account}</small>
              <strong>{user.display_name}</strong>
              <b>{roleLabel} {user.organization_name ? `· ${user.organization_name}` : ''}</b>
            </span>
          </div>
          {orgs.length > 1 && onSwitchOrg && (
            <div className="menu-org-section">
              <small style={{ padding: '0.25rem 0.75rem', color: 'var(--muted, #64748b)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Building2 size={12} /> {copy.switchOrg || 'Switch Organization'}
              </small>
              {orgs.map((org) => (
                <button
                  key={org.id}
                  role="menuitem"
                  className={user.active_organization_id === org.id || user.organization === org.id ? 'active-org-item' : ''}
                  onClick={() => { menu.setOpen(false); onSwitchOrg(org.id) }}
                  style={{ fontWeight: user.active_organization_id === org.id || user.organization === org.id ? 700 : 400 }}
                >
                  <Building2 size={16} />
                  <span>{org.name}</span>
                </button>
              ))}
            </div>
          )}
          <button role="menuitem" onClick={() => { menu.setOpen(false); onSettings() }}><Settings /><span>{copy.settings}</span></button>
          <button role="menuitem" onClick={() => { menu.setOpen(false); onSwitchPatient() }}><UserRound /><span>{copy.switchPatient}</span></button>
          <button className="sidebar-signout" role="menuitem" onClick={() => { menu.setOpen(false); onSignOut() }} disabled={!online && pendingSync > 0} title={!online && pendingSync > 0 ? copy.protectedSignOut : undefined}><LogOut /><span>{copy.signOut}</span></button>
        </div>
      )}
    </div>
  )
}

export function TopAccountMenu({ user, roleLabel, copy, online, pendingSync, syncLabel, onSettings, onSwitchPatient, onSwitchOrg, onSignOut }: AccountMenuProps) {
  const menu = useAccountMenu('.top-profile-trigger')
  const orgs = user.organizations || []
  return (
    <div className="top-profile" ref={menu.ref}>
      <button className={`top-profile-trigger ${menu.open ? 'open' : ''}`} onClick={() => menu.setOpen((current) => !current)} aria-label={copy.account} aria-expanded={menu.open} aria-haspopup="menu" aria-controls="top-account-menu">
        <span className="avatar avatar-sarah top-avatar">{initials(user.display_name)}</span>
      </button>
      {menu.open && (
        <div id="top-account-menu" className="top-profile-menu" role="menu">
          <div className="top-profile-summary">
            <span className="avatar avatar-sarah">{initials(user.display_name)}</span>
            <span>
              <small>{copy.account}</small>
              <strong>{user.display_name}</strong>
              <b>{roleLabel} {user.organization_name ? `· ${user.organization_name}` : ''}</b>
            </span>
          </div>
          <div className={`profile-sync-state ${online ? 'online' : 'offline'}`}>
            {online ? <Cloud /> : <CloudOff />}
            <span>{syncLabel}</span>
          </div>
          {orgs.length > 1 && onSwitchOrg && (
            <div className="top-menu-org-section" style={{ borderBottom: '1px solid var(--border, #e2e8f0)', paddingBottom: '0.25rem' }}>
              <div style={{ padding: '0.35rem 0.75rem', color: 'var(--muted, #64748b)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Building2 size={12} /> {copy.switchOrg || 'Switch Organization'}
              </div>
              {orgs.map((org) => (
                <button
                  key={org.id}
                  role="menuitem"
                  onClick={() => { menu.setOpen(false); onSwitchOrg(org.id) }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', padding: '0.4rem 0.75rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'inherit', fontWeight: user.active_organization_id === org.id || user.organization === org.id ? 700 : 400 }}
                >
                  <Building2 size={15} />
                  <span style={{ flex: 1 }}>{org.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="top-profile-links">
            <button role="menuitem" onClick={() => { menu.setOpen(false); onSettings() }}><Settings /><span>{copy.settings}</span><ChevronRight /></button>
            <button role="menuitem" onClick={() => { menu.setOpen(false); onSwitchPatient() }}><UserRound /><span>{copy.switchPatient}</span><ChevronRight /></button>
          </div>
          <button className="top-profile-signout" role="menuitem" onClick={() => { menu.setOpen(false); onSignOut() }} disabled={!online && pendingSync > 0} title={!online && pendingSync > 0 ? copy.protectedSignOut : undefined}><LogOut /><span>{copy.signOut}</span></button>
        </div>
      )}
    </div>
  )
}
