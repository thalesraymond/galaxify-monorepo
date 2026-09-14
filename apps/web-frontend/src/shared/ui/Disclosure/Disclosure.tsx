import type { ReactNode } from 'react'
import styles from './Disclosure.module.css'
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className={styles.disclosure}>
      <summary>{summary}</summary>
      <div>{children}</div>
    </details>
  )
}
