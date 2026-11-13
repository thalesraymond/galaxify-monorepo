import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'

import { useSession } from '@/features/auth'
import { Menu } from '@/shared/ui'
import { SkipLink } from '@/shared/ui/SkipLink'
import { classNames } from '@/shared/ui/classNames'
import styles from './AppShell.module.css'
import { BrandMark } from './BrandMark'

const primaryNavItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/dailies', label: 'Dailies' },
  { to: '/ship', label: 'Ship' },
  { to: '/expeditions', label: 'Expeditions' },
] as const

type NavigationLocationState = {
  dailyFocus?: unknown
} | null

/**
 * Account menu in the top navigation bar. Logout always completes locally,
 * even when server revocation cannot be confirmed (`docs/specs/web-frontend.md` §4.2).
 */
function AccountMenu() {
  const { manager } = useSession()
  const navigate = useNavigate()

  return (
    <Menu label="Account">
      <Link role="menuitem" to="/profile">
        Profile
      </Link>
      <button
        role="menuitem"
        type="button"
        onClick={() => {
          void manager.logout().then(() => navigate('/login', { replace: true }))
        }}
      >
        Log out
      </button>
    </Menu>
  )
}

/** Responsive After hours shell with top navigation and a <=850px Menu disclosure. */
export function AppShell() {
  const [openForPathname, setOpenForPathname] = useState<string | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const navId = useId()
  const location = useLocation()
  const previousPathnameRef = useRef(location.pathname)
  const menuOpen = openForPathname === location.pathname

  useEffect(() => {
    if (!menuOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpenForPathname(null)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    const previousPathname = previousPathnameRef.current
    previousPathnameRef.current = location.pathname
    if (previousPathname === location.pathname) {
      return
    }
    const state = location.state as NavigationLocationState
    if (state?.dailyFocus) return

    function focusRouteHeading(): boolean {
      const heading = document.querySelector<HTMLElement>('#main-content h1')
      if (!heading) return false
      if (!heading.hasAttribute('tabindex')) {
        heading.setAttribute('tabindex', '-1')
      }
      heading.focus()
      return true
    }

    if (focusRouteHeading()) return

    const main = document.getElementById('main-content')
    if (!main) return

    const observer = new MutationObserver(() => {
      if (focusRouteHeading()) {
        observer.disconnect()
      }
    })
    observer.observe(main, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
    }
  }, [location.pathname, location.state])

  return (
    <div className={styles.shell}>
      <SkipLink targetId="main-content" />
      <div className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.headerBar}>
            <Link
              className={styles.brand}
              to="/dashboard"
              onClick={() => {
                setOpenForPathname(null)
              }}
            >
              <BrandMark className={styles.brandMark} />
              <span>Galaxify</span>
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              className={styles.menuToggle}
              aria-expanded={menuOpen}
              aria-controls={navId}
              onClick={() => {
                setOpenForPathname((previous) =>
                  previous === location.pathname ? null : location.pathname,
                )
              }}
            >
              Menu
            </button>
            <nav
              id={navId}
              aria-label="Primary"
              className={classNames(styles.primaryNav, menuOpen && styles.primaryNavOpen)}
            >
              <ul>
                {primaryNavItems.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      end={item.to === '/dashboard'}
                      className={({ isActive }) =>
                        classNames(styles.navLink, isActive && styles.navLinkActive)
                      }
                      to={item.to}
                      onClick={() => {
                        setOpenForPathname(null)
                      }}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <div className={styles.accountWrap}>
              <AccountMenu />
            </div>
          </div>
        </header>
        <main className={styles.main} id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
