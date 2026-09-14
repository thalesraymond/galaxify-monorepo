import { describe, expect, it } from 'vitest'

import { validateProxyTarget } from '@/api/proxyTarget'

describe('validateProxyTarget', () => {
  it('accepts service origins and removes a harmless trailing slash', () => {
    expect(validateProxyTarget('https://services.example.test/', 'USER_SERVICE_URL')).toBe(
      'https://services.example.test',
    )
  })

  it.each([
    'localhost:8081',
    'ftp://services.example.test',
    'https://user:secret@services.example.test',
  ])('rejects non-origin proxy targets', (value) => {
    expect(() => validateProxyTarget(value, 'USER_SERVICE_URL')).toThrow('USER_SERVICE_URL')
  })
})
