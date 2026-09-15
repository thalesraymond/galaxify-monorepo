/**
 * Domain-neutral formatting for the Expedition feature. Absolute times render
 * in the browser's local timezone; the formatter is created per call so a test
 * can pin `TZ` before any render.
 */
export function formatAbsoluteTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** Compact remaining-time text such as `1h 02m 03s` or `42m 07s`. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`
  }
  return `${minutes}m ${pad(seconds)}s`
}

/** Whole-percent success chance, e.g. `15%`. */
export function formatPercentChance(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/**
 * Half of the resolve jitter window around the estimated resolve time. The
 * wire contract defines `estimated_resolve_window_seconds` as the full width.
 */
export function formatResolveWindow(windowSeconds: bigint | undefined): string {
  if (windowSeconds === undefined || windowSeconds <= 0n) {
    return ''
  }
  const halfSeconds = Number(windowSeconds) / 2
  if (halfSeconds >= 3600) {
    const hours = Math.round(halfSeconds / 3600)
    return hours === 1 ? '±1 h' : `±${hours} h`
  }
  const minutes = Math.max(1, Math.round(halfSeconds / 60))
  return `±${minutes} min`
}

/** Typed expedition reward copy: `+80 materials` or `0 materials`. */
export function formatMaterialReward(materials: number): string {
  return materials > 0 ? `+${materials} materials` : '0 materials'
}
