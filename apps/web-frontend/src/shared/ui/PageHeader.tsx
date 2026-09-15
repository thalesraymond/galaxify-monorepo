import { classNames } from './classNames'
import styles from './PageHeader.module.css'

export type PageHeaderProps = {
  /** Route-level heading. Exactly one per route. */
  title: string
  /** Optional supporting sentence rendered below the heading. */
  description?: string
  /** Surface the header sits on; the default matches the dark application shell. */
  tone?: 'on-dark' | 'on-light'
}

/**
 * Domain-neutral route header. Owns the single logical h1 for a route.
 */
export function PageHeader({ title, description, tone = 'on-dark' }: PageHeaderProps) {
  return (
    <header className={classNames(styles.header, styles[tone])}>
      <h1 className={styles.title}>{title}</h1>
      {description ? <p className={styles.description}>{description}</p> : null}
    </header>
  )
}
