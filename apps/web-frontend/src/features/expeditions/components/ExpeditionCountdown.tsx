import { useEffect, useState } from 'react'

import { formatCountdown } from './format'
import styles from './ExpeditionCountdown.module.css'

function remainingMsUntil(resolveAt: string): number {
  return Date.parse(resolveAt) - Date.now()
}

/**
 * Accessible remaining-time countdown. The visible text ticks every second but
 * the element carries a static `aria-label`, so screen readers never announce
 * individual ticks (`web-frontend.md` §5.6; `DESIGN.md` accessibility).
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
    <p className={styles.countdown} aria-label="Time remaining">
      <span className={styles.prefix}>Resolves in</span>
      <span className={styles.digits}>{formatCountdown(remainingMs)}</span>
    </p>
  )
}
