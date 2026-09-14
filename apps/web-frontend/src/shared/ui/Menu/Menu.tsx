import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import styles from './Menu.module.css'

const menuItemSelector = '[role="menuitem"]'

function getMenuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>(menuItemSelector) ?? [])
}

/** Accessible account/action menu with pointer dismissal and composite keyboard navigation. */
export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingFocusRef = useRef<'first' | 'last' | null>(null)

  useEffect(() => {
    function dismiss(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', dismiss)
    return () => {
      document.removeEventListener('mousedown', dismiss)
    }
  }, [])

  // Move focus into the menu once it is mounted, matching the WAI-ARIA menu
  // button pattern: ArrowDown opens on the first item, ArrowUp on the last.
  useLayoutEffect(() => {
    if (!open) return
    const position = pendingFocusRef.current
    if (!position) return
    pendingFocusRef.current = null
    const items = getMenuItems(menuRef.current)
    const item = position === 'first' ? items[0] : items.at(-1)
    item?.focus()
  }, [open])

  function openMenu(position: 'first' | 'last') {
    pendingFocusRef.current = position
    setOpen(true)
  }

  function closeAndRestoreFocus() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function moveMenuFocus(menu: HTMLElement, direction: -1 | 1) {
    const items = getMenuItems(menu)
    if (!items.length) return
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    if (currentIndex === -1) {
      ;(direction === 1 ? items[0] : items.at(-1))?.focus()
      return
    }
    items.at((currentIndex + direction + items.length) % items.length)?.focus()
  }

  return (
    <div className={styles.menu} ref={containerRef}>
      <button
        className={styles.trigger}
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (open) {
            setOpen(false)
          } else {
            openMenu('first')
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            openMenu('first')
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu('last')
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            closeAndRestoreFocus()
          }
        }}
      >
        {label}
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          className={styles.items}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest(menuItemSelector)) setOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeAndRestoreFocus()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              moveMenuFocus(event.currentTarget, 1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              moveMenuFocus(event.currentTarget, -1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              getMenuItems(event.currentTarget)[0]?.focus()
            } else if (event.key === 'End') {
              event.preventDefault()
              getMenuItems(event.currentTarget).at(-1)?.focus()
            }
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
