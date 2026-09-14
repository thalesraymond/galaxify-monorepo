import styles from './StatusBadge.module.css'
type Status = 'ready' | 'preparing' | 'updating' | 'delayed' | 'error'
const labels: Record<Status, string> = {
  ready: 'Ready',
  preparing: 'Preparing…',
  updating: 'Updating…',
  delayed: 'Update delayed',
  error: 'Unavailable',
}
export function StatusBadge({
  status,
  label = labels[status],
}: {
  status: Status
  label?: string
}) {
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      <span aria-hidden="true">{status === 'ready' ? '●' : status === 'error' ? '!' : '◌'}</span>
      {label}
    </span>
  )
}
