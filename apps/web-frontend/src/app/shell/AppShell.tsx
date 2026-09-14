import { Link, NavLink, Outlet } from 'react-router'

import { Menu } from '@/shared/ui'
import { SkipLink } from '@/shared/ui/SkipLink'
import { classNames } from '@/shared/ui/classNames'
import styles from './AppShell.module.css'

const primaryNavItems = [
  { to: '/dashboard', label: 'Dashboard', mark: '◈' },
  { to: '/dailies', label: 'Dailies', mark: '✓' },
  { to: '/ship', label: 'Ship', mark: '◇' },
  { to: '/expeditions', label: 'Expeditions', mark: '↗' },
] as const

function PrimaryNavigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav className={mobile ? styles.mobileNav : styles.primaryNav} aria-label="Primary">
      <ul>
        {primaryNavItems.map((item) => (
          <li key={item.to}>
            <NavLink
              end={item.to === '/dashboard'}
              className={({ isActive }) =>
                classNames(styles.navLink, isActive && styles.navLinkActive)
              }
              to={item.to}
            >
              <span aria-hidden="true" className={styles.navMark}>
                {item.mark}
              </span>
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Responsive authenticated shell with persistent desktop navigation and a mobile task-first bottom bar. */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <SkipLink targetId="main-content" />
      <aside className={styles.sidebar} aria-label="Application sidebar">
        <Link className={styles.brand} to="/dashboard">
          <span aria-hidden="true">✦</span> Galaxify
        </Link>
        <PrimaryNavigation />
        <div className={styles.sidebarAccount}>
          <Menu label="Account">
            <Link role="menuitem" to="/profile">
              Profile
            </Link>
            <button role="menuitem" type="button">
              Log out
            </button>
          </Menu>
        </div>
      </aside>
      <header className={styles.mobileHeader}>
        <Link className={styles.brand} to="/dashboard">
          <span aria-hidden="true">✦</span> Galaxify
        </Link>
        <Menu label="Account">
          <Link role="menuitem" to="/profile">
            Profile
          </Link>
          <button role="menuitem" type="button">
            Log out
          </button>
        </Menu>
      </header>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <PrimaryNavigation mobile />
    </div>
  )
}
