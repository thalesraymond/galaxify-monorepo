/**
 * Daily date/time helpers. Everything here is deterministic and timezone
 * explicit: the Player's browser-local calendar date is the default, and the
 * current-Dailies query uses explicit local-midnight RFC3339 instants.
 */

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` (browser-local) for the current instant. */
export function todayDateInput(now: Date = new Date()): string {
  return toDateInputValue(now)
}

/** `YYYY-MM-DD` for a `Date`, using its browser-local calendar fields. */
export function toDateInputValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Adds whole local calendar days to a `YYYY-MM-DD` value. */
export function addDays(dateInput: string, days: number): string {
  const parsed = parseDateInput(dateInput)
  if (parsed === undefined) {
    return dateInput
  }
  return toDateInputValue(new Date(parsed.year, parsed.month - 1, parsed.day + days))
}

/**
 * True when `value` is a calendar-valid `YYYY-MM-DD` (rejects 2026-02-30).
 */
export function isValidDateInput(value: string): boolean {
  const parsed = parseDateInput(value)
  if (parsed === undefined) {
    return false
  }
  const date = new Date(parsed.year, parsed.month - 1, parsed.day)
  return (
    date.getFullYear() === parsed.year &&
    date.getMonth() === parsed.month - 1 &&
    date.getDate() === parsed.day
  )
}

/**
 * Inclusive start and exclusive end RFC3339 instants covering the selected
 * local calendar day: local midnight → next local midnight. Constructed from
 * local calendar fields, so DST transitions cannot shift the range.
 */
export function localDayRange(dateInput: string): { readonly from: string; readonly to: string } {
  const parsed = parseDateInput(dateInput)
  if (parsed === undefined) {
    throw new Error(`Invalid local date input: ${JSON.stringify(dateInput)}`)
  }
  const from = new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0)
  const to = new Date(parsed.year, parsed.month - 1, parsed.day + 1, 0, 0, 0, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}

/** Compact due-time context, e.g. "10:00 (Europe/Paris)". */
export function dueTimeContext(dueLocalTime: string, timeZone: string): string {
  return `${dueLocalTime} (${timeZone})`
}

/**
 * Human group label for a preserved-zone occurrence date. Parses the calendar
 * components and formats them through UTC so the label never shifts across
 * the reader's own timezone.
 */
export function formatOccurrenceDate(dueLocalDate: string): string {
  const parsed = parseDateInput(dueLocalDate)
  if (parsed === undefined) {
    return dueLocalDate
  }
  return OCCURRENCE_FORMATTER.format(
    new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12)),
  )
}

const OCCURRENCE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

/** Wall-clock time of an instant rendered in a preserved IANA zone, "HH:MM". */
export function formatTimeInZone(instant: string, timeZone: string): string {
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date)
}

type DateParts = { readonly year: number; readonly month: number; readonly day: number }

function parseDateInput(value: string): DateParts | undefined {
  if (!DATE_INPUT_PATTERN.test(value)) {
    return undefined
  }
  const [year, month, day] = value.split('-')
  if (year === undefined || month === undefined || day === undefined) {
    return undefined
  }
  return { year: Number(year), month: Number(month), day: Number(day) }
}
