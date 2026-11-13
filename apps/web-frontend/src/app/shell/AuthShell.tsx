import { Outlet } from 'react-router'

import { SkipLink } from '@/shared/ui/SkipLink'
import styles from './AuthShell.module.css'
import { BrandMark } from './BrandMark'

/**
 * Focused authentication shell for `/signup` and `/login`. It deliberately has
 * no primary navigation, matching `docs/specs/web-frontend.md` §5.1.
 */
export function AuthShell() {
  return (
    <div className={styles.shell}>
      <SkipLink targetId="auth-main" />
      <header className={styles.header}>
        <div className={styles.brand}>
          <BrandMark className={styles.brandMark} />
          <span>Galaxify</span>
        </div>
        <p className={styles.subtitle}>Evening personal reflection and spacecraft upkeep.</p>
      </header>
      <main className={styles.main} id="auth-main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
