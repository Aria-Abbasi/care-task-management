import { useEffect, useRef, type RefObject } from 'react'

/** Keeps feature-owned dialogs keyboard-contained and restores their trigger. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const dialog = ref.current
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog) return

    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [role="menuitem"]',
    )]

    // Move focus into the dialog on mount ONLY if focus is not already inside it (e.g. by autoFocus)
    const frame = window.requestAnimationFrame(() => {
      if (dialog && !dialog.contains(document.activeElement)) {
        const autoFocusEl = dialog.querySelector<HTMLElement>('[autofocus]')
        ;(autoFocusEl || focusable()[0] || dialog).focus()
      }
    })

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = focusable()
      if (!controls.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeydown)
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) {
        previousFocus.focus()
      }
    }
  }, [ref])
}
