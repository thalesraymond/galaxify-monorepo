import { Link, NavLink, Outlet } from 'react-router'

import { SkipLink } from '@/shared/ui/SkipLink'
import { classNames } from '@/shared/ui/classNames'
import styles from './AppShell.module.css'

const primaryNavItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/dailies', label: 'Dailies' },
  { to: '/ship', label: 'Ship' },
  { to: '/expeditions', label: 'Expeditions' },
] as const

/**
 * Authenticated application shell: skip link, banner, primary navigation, and
 * the routed main landmark. Exactly one `h1` is owned by the routed page.
 */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <SkipLink targetId="main-content" />
      <header className={styles.header}>
        <p className={styles.brand}>
          <Link className={styles.brandLink} to="/dashboard">
            Galaxify
          </Link>
        </p>
        <nav className={styles.primaryNav} aria-label="Primary">
          <ul className={styles.navList}>
            {primaryNavItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  className={({ isActive }) =>
                    classNames(styles.navLink, isActive && styles.navLinkActive)
                  }
                  to={item.to}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <nav className={styles.accountNav} aria-label="Account">
          <Link className={styles.accountLink} to="/profile">
            Profile
          </Link>
        </nav>
      </header>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
