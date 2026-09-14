import styles from './Skeleton.module.css'
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading content">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
      <span className={styles.srOnly}>Loading…</span>
    </div>
  )
}
