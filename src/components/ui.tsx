import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

export function Button({ variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button {...props} className={`${variant}-button ${props.className || ''}`.trim()} />
}

export function Card({ children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section {...props} className={`main-card ${props.className || ''}`.trim()}>{children}</section>
}

export function StatusPill({ status, children }: { status: string; children?: ReactNode }) {
  return <b className={`status-pill ${status.toLowerCase()}`}>{children || status.replaceAll('_', ' ').toLowerCase()}</b>
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>
}
