import { describe, expect, it } from 'vitest'

import { formatUpdatedAt } from './format'

const NOW_MS = Date.UTC(2026, 0, 15, 9, 0, 0)

describe('formatUpdatedAt', () => {
  it('labels a recent update as just now', () => {
    expect(formatUpdatedAt('2026-01-15T09:00:00Z', NOW_MS)).toBe('Updated just now')
  })

  it('formats minutes, hours, and days', () => {
    expect(formatUpdatedAt('2026-01-15T08:58:00Z', NOW_MS)).toBe('Updated 2 minutes ago')
    expect(formatUpdatedAt('2026-01-15T05:00:00Z', NOW_MS)).toBe('Updated 4 hours ago')
    expect(formatUpdatedAt('2026-01-12T09:00:00Z', NOW_MS)).toBe('Updated 3 days ago')
  })

  it('falls back to the absolute value when the timestamp cannot be parsed', () => {
    expect(formatUpdatedAt('not-a-timestamp', NOW_MS)).toBe('Updated not-a-timestamp')
  })
})
