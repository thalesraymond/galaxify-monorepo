/**
 * Bounded poll rate for an in-flight Expedition derived from `resolve_at`
 * (§5.6/§5.7): never polls once resolved, and tightens toward a 1s floor as
 * resolution approaches. Shared by the overview and detail pages.
 */
export function boundedResolvePollMs(resolveAt: string): number {
  const remaining = Date.parse(resolveAt) - Date.now()
  return Math.max(1_000, Math.min(60_000, remaining))
}
