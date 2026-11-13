import { ContentSurface } from './ContentSurface/ContentSurface'
import skeletonStyles from './Skeleton/Skeleton.module.css'

export type RouteFallbackProps = {
  /** Human-readable label announced while a lazy route loads. */
  label?: string
}

/**
 * Minimal route-shaped suspense fallback. Feature routes may swap this with
 * section-shaped skeletons per `docs/specs/web-frontend.md` §3.2.
 */
export function RouteFallback({ label = 'Loading…' }: RouteFallbackProps) {
  return (
    <ContentSurface aria-busy="true">
      <div className={skeletonStyles.skeleton} role="status" aria-live="polite">
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span className={skeletonStyles.srOnly}>{label}</span>
      </div>
    </ContentSurface>
  )
}
