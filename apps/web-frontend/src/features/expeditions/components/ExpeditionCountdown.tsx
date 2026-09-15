import { useEffect, useState } from 'react'

import { formatCountdown } from './format'
import styles from './ExpeditionCountdown.module.css'

function remainingMsUntil(resolveAt: string): number {
  return Date.parse(resolveAt) - Date.now()
}

/**
 * Accessible remaining-time countdown. The visible text ticks every second but
 * the element is never a live region: screen readers read the current value
 * from the visually-hidden "Time remaining:" label plus the ticking digits
 * (e.g. on focus) and are never announced individual ticks
 * (`web-frontend.md` §5.6; `DESIGN.md` accessibility).
 */
export function ExpeditionCountdown({ resolveAt }: { resolveAt: string }) {
  const [remainingMs, setRemainingMs] = useState(() => remainingMsUntil(resolveAt))

  useEffect(() => {
    const update = (): void => {
      setRemainingMs(remainingMsUntil(resolveAt))
    }
    update()
    const handle = window.setInterval(update, 1_000)
    return () => {
      window.clearInterval(handle)
    }
  }, [resolveAt])

  return (
    <p className={styles.countdown}>
      <span className={styles.srOnly}>Time remaining: </span>
      <span aria-hidden="true" className={styles.prefix}>
        Resolves in
      </span>
      <span className={styles.digits}>{formatCountdown(remainingMs)}</span>
    </p>
  )
}
