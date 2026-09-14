import { NavLink } from 'react-router'
import { classNames } from '../classNames'
import styles from './LocalTabs.module.css'
export type LocalTab = { to: string; label: string; end?: boolean }
export function LocalTabs({ label, tabs }: { label: string; tabs: readonly LocalTab[] }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              {...(tab.end === undefined ? {} : { end: tab.end })}
              to={tab.to}
              className={({ isActive }) => classNames(styles.tab, isActive && styles.active)}
            >
              {tab.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
