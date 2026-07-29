import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Cloud, CloudOff, LogOut, MoreHorizontal, Settings, UserRound } from 'lucide-react'

import type { ApiUser } from '../lib/types'

type AccountCopy = {
  account: string
  settings: string
  switchPatient: string
  signOut: string
  protectedSignOut: string
  more: string
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

export function SidebarAccountMenu({ user, roleLabel, copy, online, pendingSync, onSettings, onSwitchPatient, onSignOut }: AccountMenuProps) {
  const menu = useAccountMenu('.sidebar-profile-more')
  return <div className="sidebar-profile" ref={menu.ref}><button className="profile-row" onClick={onSettings}><div className="avatar avatar-sarah">{initials(user.display_name)}</div><div><strong>{user.display_name}</strong><span>{roleLabel}</span></div></button><button className={`sidebar-profile-more ${menu.open ? 'open' : ''}`} onClick={() => menu.setOpen((current) => !current)} aria-label={copy.more} aria-expanded={menu.open} aria-haspopup="menu" aria-controls="sidebar-account-menu"><MoreHorizontal size={19} /></button>{menu.open && <div id="sidebar-account-menu" className="sidebar-account-menu" role="menu"><div className="sidebar-account-head"><span className="avatar avatar-sarah">{initials(user.display_name)}</span><span><small>{copy.account}</small><strong>{user.display_name}</strong><b>{roleLabel}</b></span></div><button role="menuitem" onClick={() => { menu.setOpen(false); onSettings() }}><Settings /><span>{copy.settings}</span></button><button role="menuitem" onClick={() => { menu.setOpen(false); onSwitchPatient() }}><UserRound /><span>{copy.switchPatient}</span></button><button className="sidebar-signout" role="menuitem" onClick={() => { menu.setOpen(false); onSignOut() }} disabled={!online && pendingSync > 0} title={!online && pendingSync > 0 ? copy.protectedSignOut : undefined}><LogOut /><span>{copy.signOut}</span></button></div>}</div>
}

export function TopAccountMenu({ user, roleLabel, copy, online, pendingSync, syncLabel, onSettings, onSwitchPatient, onSignOut }: AccountMenuProps) {
  const menu = useAccountMenu('.top-profile-trigger')
  return <div className="top-profile" ref={menu.ref}><button className={`top-profile-trigger ${menu.open ? 'open' : ''}`} onClick={() => menu.setOpen((current) => !current)} aria-label={copy.account} aria-expanded={menu.open} aria-haspopup="menu" aria-controls="top-account-menu"><span className="avatar avatar-sarah top-avatar">{initials(user.display_name)}</span></button>{menu.open && <div id="top-account-menu" className="top-profile-menu" role="menu"><div className="top-profile-summary"><span className="avatar avatar-sarah">{initials(user.display_name)}</span><span><small>{copy.account}</small><strong>{user.display_name}</strong><b>{roleLabel}</b></span></div><div className={`profile-sync-state ${online ? 'online' : 'offline'}`}>{online ? <Cloud /> : <CloudOff />}<span>{syncLabel}</span></div><div className="top-profile-links"><button role="menuitem" onClick={() => { menu.setOpen(false); onSettings() }}><Settings /><span>{copy.settings}</span><ChevronRight /></button><button role="menuitem" onClick={() => { menu.setOpen(false); onSwitchPatient() }}><UserRound /><span>{copy.switchPatient}</span><ChevronRight /></button></div><button className="top-profile-signout" role="menuitem" onClick={() => { menu.setOpen(false); onSignOut() }} disabled={!online && pendingSync > 0} title={!online && pendingSync > 0 ? copy.protectedSignOut : undefined}><LogOut /><span>{copy.signOut}</span></button></div>}</div>
}
