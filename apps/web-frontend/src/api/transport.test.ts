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
      transport.request({
        service: 'user',
        path: '/users/me',
        response: zUserGetMeResponse,
      }),
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
      transport.request({
        service: 'user',
        path: '/users/me',
        response: zUserGetMeResponse,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response', status: 200 })
  })

  it('rejects malformed shared error envelopes as invalid responses', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: 'missing code' } }, { status: 500 }))
    const transport = new ApiTransport({ fetch: fetch as typeof globalThis.fetch })

    await expect(
      transport.request({
        service: 'user',
        path: '/users/me',
        response: zUserGetMeResponse,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response', status: 500 })
  })

  it('normalizes aborted requests separately from network failures', async () => {
    const fetch = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError'))
    const transport = new ApiTransport({ fetch: fetch as typeof globalThis.fetch })

    await expect(
      transport.request({
        service: 'user',
        path: '/users/me',
        response: zUserGetMeResponse,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' })
  })
})

describe('ApiTransport session hooks', () => {
  it('awaits pre-refresh before sending the request', async () => {
    const order: string[] = []
    let authorization: string | null = null
    const fetch: typeof globalThis.fetch = (_url, init) => {
      order.push('fetch')
      authorization = new Headers(init?.headers).get('Authorization')
      return Promise.resolve(jsonResponse(user))
    }
    const transport = new ApiTransport({
      fetch,
      getAccessToken: () => 'fresh-token',
      beforeRequest: () => {
        order.push('refresh')
        return Promise.resolve()
      },
    })

    await transport.request({
      service: 'user',
      path: '/users/me',
      response: zUserGetMeResponse,
    })

    expect(order).toEqual(['refresh', 'fetch'])
    expect(authorization).toBe('Bearer fresh-token')
  })

  it('refreshes once and replays a bearer-protected AUTH_INVALID_TOKEN', async () => {
    let calls = 0
    let token = 'expired-token'
    const fetch: typeof globalThis.fetch = (_url, init) => {
      calls += 1
      const bearer = new Headers(init?.headers).get('Authorization')
      if (bearer === 'Bearer expired-token') {
        return Promise.resolve(unauthorizedResponse())
      }
      return Promise.resolve(jsonResponse(user))
    }
    const transport = new ApiTransport({
      fetch,
      getAccessToken: () => token,
      onUnauthorized: () => {
        token = 'rotated-token'
        return Promise.resolve(true)
      },
    })

    await expect(
      transport.request({ service: 'user', path: '/users/me', response: zUserGetMeResponse }),
    ).resolves.toEqual(user)
    expect(calls).toBe(2)
  })

  it('never enters the replay path without a bearer token', async () => {
    const fetch = vi.fn().mockResolvedValue(unauthorizedResponse())
    const onUnauthorized = vi.fn().mockResolvedValue(true)
    const transport = new ApiTransport({
      fetch: fetch as typeof globalThis.fetch,
      onUnauthorized,
    })

    await expect(
      transport.request({ service: 'user', path: '/users/me', response: zUserGetMeResponse }),
    ).rejects.toMatchObject({ kind: 'api', code: 'AUTH_INVALID_TOKEN' })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never enters the replay path for auth endpoints such as login', async () => {
    const fetch = vi.fn().mockResolvedValue(unauthorizedResponse())
    const onUnauthorized = vi.fn().mockResolvedValue(true)
    const transport = new ApiTransport({
      fetch: fetch as typeof globalThis.fetch,
      getAccessToken: () => 'access-token',
      onUnauthorized,
    })

    await expect(
      transport.request({
        service: 'user',
        path: '/auth/login',
        method: 'POST',
        body: { email: 'captain@example.com', password: 'password123' },
        response: zUserGetMeResponse,
      }),
    ).rejects.toMatchObject({ kind: 'api', code: 'AUTH_INVALID_TOKEN' })
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('replays at most once even when the replay is unauthorized again', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(unauthorizedResponse()))
    const onUnauthorized = vi.fn().mockResolvedValue(true)
    const transport = new ApiTransport({
      fetch: fetch as typeof globalThis.fetch,
      getAccessToken: () => 'access-token',
      onUnauthorized,
    })

    await expect(
      transport.request({ service: 'user', path: '/users/me', response: zUserGetMeResponse }),
    ).rejects.toMatchObject({ kind: 'api', code: 'AUTH_INVALID_TOKEN' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

function unauthorizedResponse(): Response {
  return jsonResponse(
    { error: { code: 'AUTH_INVALID_TOKEN', message: 'The access token is invalid.' } },
    { status: 401 },
  )
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { ...init, headers })
}
