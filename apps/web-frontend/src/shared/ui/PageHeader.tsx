import styles from './PageHeader.module.css'

export type PageHeaderProps = {
  /** Route-level heading. Exactly one per route. */
  title: string
  /** Optional supporting sentence rendered below the heading. */
  description?: string
}

/**
 * Domain-neutral route header. Owns the single logical h1 for a route.
 */
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {description ? <p className={styles.description}>{description}</p> : null}
    </header>
  )
}
