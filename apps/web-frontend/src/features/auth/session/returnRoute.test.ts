import { describe, expect, it } from 'vitest'

import { captureReturnRoute, isSafeReturnRoute, readSafeReturnRoute } from './returnRoute'

describe('safe return routes', () => {
  it('accepts internal GET-like routes with search state', () => {
    expect(isSafeReturnRoute('/dashboard')).toBe(true)
    expect(isSafeReturnRoute('/dailies?date=2026-01-15&status=PENDING')).toBe(true)
    expect(isSafeReturnRoute('/expeditions/abc-123')).toBe(true)
  })

  it('rejects external, protocol-relative, and auth routes', () => {
    expect(isSafeReturnRoute('https://evil.example/steal')).toBe(false)
    expect(isSafeReturnRoute('//evil.example/steal')).toBe(false)
    expect(isSafeReturnRoute('/login')).toBe(false)
    expect(isSafeReturnRoute('/login?returnTo=%2Fdashboard')).toBe(false)
    expect(isSafeReturnRoute('/signup')).toBe(false)
    expect(isSafeReturnRoute('')).toBe(false)
    expect(isSafeReturnRoute(42)).toBe(false)
    expect(isSafeReturnRoute(undefined)).toBe(false)
  })

  it('rejects control characters that could smuggle a header or URL', () => {
    expect(isSafeReturnRoute('/dashboard\nX-Injected: 1')).toBe(false)
    expect(isSafeReturnRoute('/dashboard\u0000')).toBe(false)
  })

  it('captures the current location only when it is safe', () => {
    expect(captureReturnRoute({ pathname: '/ship', search: '?tab=repair' })).toBe(
      '/ship?tab=repair',
    )
    expect(captureReturnRoute({ pathname: '/dashboard', search: '' })).toBe('/dashboard')
  })

  it('reads a validated return route from router state', () => {
    expect(readSafeReturnRoute({ returnTo: '/ship' })).toBe('/ship')
    expect(readSafeReturnRoute({ returnTo: 'https://evil.example' })).toBeUndefined()
    expect(readSafeReturnRoute(null)).toBeUndefined()
    expect(readSafeReturnRoute({})).toBeUndefined()
  })
})
