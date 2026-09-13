import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

import styles from './AppErrorBoundary.module.css'

/**
 * Route-level error boundary wired as `errorElement` on both shells. It keeps
 * the player inside a labeled recovery state instead of a blank page.
 */
export function AppErrorBoundary() {
  const error = useRouteError()

  const description = isRouteErrorResponse(error)
    ? `${String(error.status)} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'An unexpected error interrupted this page.'

  return (
    <section className={styles.error} aria-labelledby="route-error-title">
      <h1 className={styles.title} id="route-error-title">
        Something went wrong
      </h1>
      <p className={styles.description}>{description}</p>
      <Link className={styles.action} to="/dashboard">
        Back to Dashboard
      </Link>
    </section>
  )
}
