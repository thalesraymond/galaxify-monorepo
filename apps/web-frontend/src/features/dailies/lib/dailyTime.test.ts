process.env.TZ = 'UTC'
import { describe, expect, it } from 'vitest'

import {
  addDays,
  dueTimeContext,
  formatOccurrenceDate,
  formatTimeInZone,
  isValidDateInput,
  localDayRange,
  toDateInputValue,
  todayDateInput,
} from './dailyTime'

describe('dailyTime', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(todayDateInput(new Date(Date.UTC(2026, 0, 15, 9, 0, 0)))).toBe('2026-01-15')
    expect(toDateInputValue(new Date(2026, 11, 3))).toBe('2026-12-03')
    expect(toDateInputValue(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('adds local calendar days across month boundaries', () => {
    expect(addDays('2026-01-15', 1)).toBe('2026-01-16')
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('validates calendar dates, not just the format', () => {
    expect(isValidDateInput('2026-01-15')).toBe(true)
    expect(isValidDateInput('2026-02-30')).toBe(false)
    expect(isValidDateInput('2026-13-01')).toBe(false)
    expect(isValidDateInput('not-a-date')).toBe(false)
  })

  it('computes local-midnight RFC3339 range for a selected date', () => {
    expect(localDayRange('2026-01-15')).toEqual({
      from: '2026-01-15T00:00:00.000Z',
      to: '2026-01-16T00:00:00.000Z',
    })
    expect(() => localDayRange('bogus')).toThrow(/Invalid local date input/)
  })

  it('renders due-time context with the preserved zone', () => {
    expect(dueTimeContext('09:30', 'Europe/Paris')).toBe('09:30 (Europe/Paris)')
  })

  it('formats occurrence dates without local-timezone shifting', () => {
    expect(formatOccurrenceDate('2026-01-14')).toBe('January 14, 2026')
    expect(formatOccurrenceDate('bogus')).toBe('bogus')
  })

  it('formats an instant in the preserved zone', () => {
    expect(formatTimeInZone('2026-01-15T10:30:00Z', 'UTC')).toBe('10:30')
    expect(formatTimeInZone('not-an-instant', 'UTC')).toBe('')
  })
})
