import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import styles from './Menu.module.css'

export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function dismiss(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    return () => {
      document.removeEventListener('mousedown', dismiss)
    }
  }, [])
  return (
    <div className={styles.menu} ref={containerRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpen((value) => !value)
        }}
      >
        {label}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          tabIndex={-1}
          className={styles.items}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
              ;(event.currentTarget.previousElementSibling as HTMLElement | null)?.focus()
            }
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
