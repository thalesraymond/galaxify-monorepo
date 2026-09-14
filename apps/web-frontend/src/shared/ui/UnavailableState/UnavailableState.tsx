import { Button } from '../Button/Button'
import { StatusBadge } from '../StatusBadge/StatusBadge'
import styles from './UnavailableState.module.css'
export function UnavailableState({
  title = 'This section is unavailable',
  description = 'Try again when you are ready.',
  onRetry,
  delayed = false,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  delayed?: boolean
}) {
  return (
    <section className={styles.state}>
      <StatusBadge status={delayed ? 'delayed' : 'error'} />
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </section>
  )
}
