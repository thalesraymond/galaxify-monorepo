import type { ReactNode } from 'react'
import { classNames } from '../classNames'
import styles from './EmptyState.module.css'
export function EmptyState({
  title,
  children,
  action,
  embedded = false,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
  embedded?: boolean
}) {
  return (
    <section className={classNames(styles.empty, embedded && styles.embedded)}>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </section>
  )
}
