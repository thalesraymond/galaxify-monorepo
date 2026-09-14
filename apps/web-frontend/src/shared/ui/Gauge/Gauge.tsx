import styles from './Gauge.module.css'
export function Gauge({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const safeValue = Math.min(Math.max(value, 0), max)
  return (
    <div className={styles.gauge}>
      <div className={styles.label}>
        <span>{label}</span>
        <strong>
          {safeValue} / {max}
        </strong>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={safeValue}
        className={styles.track}
      >
        <span style={{ width: `${(safeValue / max) * 100}%` }} />
      </div>
    </div>
  )
}
