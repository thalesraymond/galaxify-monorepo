export type RouteFallbackProps = {
  /** Human-readable label announced while a lazy route loads. */
  label?: string
}

/**
 * Minimal route-shaped suspense fallback. Feature tickets replace this with
 * section-shaped skeletons per `docs/specs/web-frontend.md` §3.2.
 */
export function RouteFallback({ label = 'Loading…' }: RouteFallbackProps) {
  return (
    <div role="status" aria-live="polite">
      {label}
    </div>
  )
}
