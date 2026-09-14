import { ApiTransport } from '@/api/transport'
import { describe, expect, it } from 'vitest'

import { getProfile, profileQueryKey } from './profileApi'

describe('profile API adapter', () => {
  it('owns the profile query key and user operation', async () => {
    let url = ''
    const transport = new ApiTransport({
      fetch: (input) => {
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return Promise.resolve(jsonResponse(profile))
      },
    })

    await expect(getProfile(transport)).resolves.toEqual(profile)
    expect(profileQueryKey).toEqual(['profile'])
    expect(url).toBe('/api/user/users/me')
  })
})

const profile = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  email: 'captain@example.com',
  username: 'captain',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}
