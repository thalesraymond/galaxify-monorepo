import { useEffect, useRef, type ReactNode } from 'react'
import styles from './Dialog.module.css'

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = dialogRef.current?.querySelector<HTMLElement>(focusable)
    first?.focus()
    function trapFocus(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusable) ?? [])
      const firstFocusable = items[0]
      const lastFocusable = items.at(-1)
      if (!firstFocusable || !lastFocusable) return
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault()
        lastFocusable.focus()
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault()
        firstFocusable.focus()
      }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.removeEventListener('keydown', trapFocus)
      returnFocusRef.current?.focus()
    }
  }, [onClose])
  return (
    <div className={styles.overlay}>
      <div
        className={styles.dialog}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <header>
          <h2 id="dialog-title">{title}</h2>
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
