import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className={styles.empty}>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </section>
  )
}
