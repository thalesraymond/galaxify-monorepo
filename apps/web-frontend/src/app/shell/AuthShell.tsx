import { Outlet } from 'react-router'

import { SkipLink } from '@/shared/ui/SkipLink'
import styles from './AuthShell.module.css'

/**
 * Focused authentication shell for `/signup` and `/login`. It deliberately has
 * no primary navigation, matching `docs/specs/web-frontend.md` §5.1.
 */
export function AuthShell() {
  return (
    <div className={styles.shell}>
      <SkipLink targetId="auth-main" />
      <header className={styles.header}>
        <p className={styles.brand}>Galaxify</p>
      </header>
      <main className={styles.main} id="auth-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
