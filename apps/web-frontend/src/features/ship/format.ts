const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Stable relative "Updated …" label for the Ship's `updated_at` timestamp.
 * Falls back to the raw timestamp when it cannot be parsed.
 */
export function formatUpdatedAt(updatedAtIso: string, nowMs: number): string {
  const updatedAtMs = new Date(updatedAtIso).getTime()
  if (Number.isNaN(updatedAtMs)) {
    return `Updated ${updatedAtIso}`
  }
  const elapsedMs = updatedAtMs - nowMs
  if (Math.abs(elapsedMs) < MINUTE_MS) {
    return 'Updated just now'
  }
  const minutes = Math.round(elapsedMs / MINUTE_MS)
  if (Math.abs(minutes) < 60) {
    return `Updated ${relativeTime.format(minutes, 'minute')}`
  }
  const hours = Math.round((minutes * MINUTE_MS) / HOUR_MS)
  if (Math.abs(hours) < 24) {
    return `Updated ${relativeTime.format(hours, 'hour')}`
  }
  const days = Math.round((hours * HOUR_MS) / DAY_MS)
  return `Updated ${relativeTime.format(days, 'day')}`
}
