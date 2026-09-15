import { useId } from 'react'

import { Link } from 'react-router'

import { ContentSurface } from '@/shared/ui'
import styles from './expeditionPanels.module.css'

/** Domain recovery state inside the shell — never a silent redirect (§2). */
export function ExpeditionNotFound() {
  const headingId = useId()
  return (
    <ContentSurface aria-labelledby={headingId}>
      <h2 id={headingId}>Expedition not found</h2>
      <p>We could not find that Expedition. It may have been removed.</p>
      <nav className={styles.links} aria-label="Expedition recovery">
        <Link to="/expeditions">Back to Expeditions</Link>
      </nav>
    </ContentSurface>
  )
}
