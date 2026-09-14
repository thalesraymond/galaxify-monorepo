import { zUserGetMeResponse, zUserLogoutResponse } from './generated/user/zod.gen'
import { ApiTransport } from './transport'
import { describe, expect, it, vi } from 'vitest'

const user = {
  id: '0f8fad5b-d9cb-469f-a165-70867728950e',
  email: 'captain@example.com',
  username: 'captain',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('ApiTransport', () => {
  it('uses a relative service path, auth, request ID, query, and generated response schema', async () => {
    let actualUrl = ''
    let actualInit: RequestInit | undefined
    const fetch: typeof globalThis.fetch = (url, init) => {
      actualUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      actualInit = init
      return Promise.resolve(jsonResponse(user, { headers: { 'X-Request-Id': 'server-id' } }))
    }
    const transport = new ApiTransport({
      fetch,
      getAccessToken: () => 'access-token',
      createRequestId: () => 'client-id',
    })

    await expect(
      transport.request({
        service: 'user',
        path: '/users/me',
        query: { include: 'profile', ignored: undefined },
        response: zUserGetMeResponse,
      }),
    ).resolves.toEqual(user)

    expect(actualUrl).toBe('/api/user/users/me?include=profile')
    const headers = new Headers(actualInit?.headers)
    expect(headers.get('Authorization')).toBe('Bearer access-token')
    expect(headers.get('X-Request-Id')).toBe('client-id')
  })

  it('returns no-content responses without attempting JSON parsing', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    const transport = new ApiTransport({ fetch: fetch as typeof globalThis.fetch })

    await expect(
      transport.request({
        service: 'user',
        path: '/auth/logout',
        method: 'POST',
        response: zUserLogoutResponse,
      }),
    ).resolves.toBeUndefined()
  })

  it('normalizes API errors and preserves backend field errors and request reference', async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Request validation failed',
            details: { field_errors: { username: 'already taken' } },
          },
        },
        { status: 422, headers: { 'X-Request-Id': 'request-reference' } },
      ),
    )
    const transport = new ApiTransport({ fetch: fetch as typeof globalThis.fetch })

    await expect(
      transport.request({ service: 'user', path: '/users/me', response: zUserGetMeResponse }),
    ).rejects.toMatchObject({
      kind: 'api',
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      fieldErrors: { username: 'already taken' },
      requestId: 'request-reference',
    })
  })

  it('rejects malformed success bodies as invalid responses', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'not-a-uuid' }))
    const transport = new ApiTransport({ fetch: fetch as typeof globalThis.fetch })

    await expect(
      transport.request({ service: 'user', path: '/users/me', response: zUserGetMeResponse }),
    ).rejects.toMatchObject({ kind: 'invalid_response', status: 200 })
  })

  it('normalizes aborted requests separately from network failures', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    const transport = new ApiTransport({ fetch: fetch as typeof globalThis.fetch })

    await expect(
      transport.request({ service: 'user', path: '/users/me', response: zUserGetMeResponse }),
    ).rejects.toMatchObject({ kind: 'aborted' })
  })
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}
