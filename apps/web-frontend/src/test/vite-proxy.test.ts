import { describe, expect, it } from 'vitest'

import { parseProxyEnvironment } from '@/api/proxyTarget'

describe('parseProxyEnvironment', () => {
  it('accepts a service origin and normalizes a harmless trailing slash', () => {
    expect(parseProxyEnvironment({ USER_SERVICE_URL: 'https://services.example.test/' })).toEqual({
      USER_SERVICE_URL: 'https://services.example.test',
      DAILY_SERVICE_URL: 'http://localhost:8082',
      SHIP_SERVICE_URL: 'http://localhost:8083',
      EXPEDITION_SERVICE_URL: 'http://localhost:8084',
    })
  })

  it('applies the documented local service defaults', () => {
    expect(parseProxyEnvironment({})).toEqual({
      USER_SERVICE_URL: 'http://localhost:8081',
      DAILY_SERVICE_URL: 'http://localhost:8082',
      SHIP_SERVICE_URL: 'http://localhost:8083',
      EXPEDITION_SERVICE_URL: 'http://localhost:8084',
    })
  })

  it.each([
    'localhost:8081',
    'ftp://services.example.test',
    'https://user:secret@services.example.test',
    'https://services.example.test/path',
  ])('rejects non-origin proxy target %s', (value) => {
    expect(() => parseProxyEnvironment({ USER_SERVICE_URL: value })).toThrow('USER_SERVICE_URL')
  })

  it('rejects an empty configured target instead of falling back to the default', () => {
    expect(() => parseProxyEnvironment({ SHIP_SERVICE_URL: '' })).toThrow('SHIP_SERVICE_URL')
  })
})
