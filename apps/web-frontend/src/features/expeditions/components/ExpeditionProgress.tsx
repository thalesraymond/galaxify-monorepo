import { useId } from 'react'

import { Link } from 'react-router'

import { ContentSurface } from '@/shared/ui'

import type { Expedition } from '../api/expeditionApi'
import { formatAbsoluteTime, formatPercentChance } from './format'
import { ExpeditionCountdown } from './ExpeditionCountdown'
import { MaterialsBalance, type MaterialsSync } from './MaterialsBalance'
import styles from './expeditionPanels.module.css'

/**
 * In-flight progress: accessible remaining-time countdown dominates, then the
 * mission facts and detail/history links. A balance sync line renders when the
 * overview is reconciling the Ship deduction.
 */
export function ExpeditionProgress({
  expedition,
  showLinks = false,
  balanceSync,
}: {
  expedition: Expedition
  showLinks?: boolean
  balanceSync?: MaterialsSync | undefined
}) {
  const headingId = useId()
  return (
    <ContentSurface tone="raised" aria-labelledby={headingId}>
      <h2 id={headingId}>Expedition in flight</h2>
      <ExpeditionCountdown resolveAt={expedition.resolve_at} />
      <p className={styles.resolveTime}>Resolves at {formatAbsoluteTime(expedition.resolve_at)}.</p>
      <dl className={styles.facts}>
        <div>
          <dt>Investment</dt>
          <dd>{expedition.materials_invested} materials</dd>
        </div>
        <div>
          <dt>Success chance</dt>
          <dd>{formatPercentChance(expedition.success_chance)}</dd>
        </div>
        <div>
          <dt>Launched</dt>
          <dd>{formatAbsoluteTime(expedition.created_at)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>In flight</dd>
        </div>
      </dl>
      {balanceSync !== undefined ? <MaterialsBalance sync={balanceSync} /> : null}
      {showLinks ? (
        <nav className={styles.links} aria-label="Expedition links">
          <Link to={`/expeditions/${expedition.id}`}>View Expedition detail</Link>
          <Link to="/expeditions/history">View history</Link>
        </nav>
      ) : null}
    </ContentSurface>
  )
}
