import {
  http,
  HttpResponse,
  type HttpResponseResolver,
  type JsonBodyType,
  type RequestHandler,
} from 'msw'
import type { ZodType } from 'zod'

import {
  zCreateDailyRequest,
  zDailyCreateResponse,
  zDailyDifficultiesResponse,
  zDailyGetResponse,
  zDailyListResponse,
  zUpdateDailyRequest,
  zDailyUpdateResponse,
  zDailyCompleteResponse,
  zDailyHistoryResponse,
} from '@/api/generated/daily/zod.gen'
import {
  zExpeditionCurrentResponse,
  zExpeditionGetResponse,
  zExpeditionLaunchBody,
  zExpeditionLaunchResponse,
  zExpeditionListResponse,
  zExpeditionQuoteResponse,
} from '@/api/generated/expedition/zod.gen'
import { zShipGetMeResponse, zShipRepairResponse } from '@/api/generated/ship/zod.gen'
import {
  zAuthSessionResponse,
  zDeleteMeRequest,
  zJwksResponse,
  zLoginRequest,
  zLogoutRequest,
  zRefreshRequest,
  zRefreshResponse,
  zSignupRequest,
  zUpdateMeRequest,
  zUserResponse,
} from '@/api/generated/user/zod.gen'

import { MockApiError, type MockBackend } from './backend'

const API_PREFIX = '/api/'

/**
 * Builds the strict MSW handler set over the generated `/api/{service}`
 * contracts. The same factory backs the browser worker and the shared test
 * server so component tests never diverge from development behavior.
 */
export function createMockHandlers(backend: MockBackend): RequestHandler[] {
  return [
    // --- User Service ----------------------------------------------------
    http.get(
      '/api/user/health',
      handle(backend, ({ request }) =>
        json({ status: 'ok', service: 'user-service' }, 200, headers(request, backend)),
      ),
    ),
    http.post(
      '/api/user/users',
      handle(backend, async ({ request }) => {
        const body = await parseBody(request, zSignupRequest)
        return respond(zAuthSessionResponse, backend.signup(body), 201, request, backend)
      }),
    ),
    http.post(
      '/api/user/auth/login',
      handle(backend, async ({ request }) => {
        const body = await parseBody(request, zLoginRequest)
        return respond(zAuthSessionResponse, backend.login(body), 200, request, backend)
      }),
    ),
    http.post(
      '/api/user/auth/refresh',
      handle(backend, async ({ request }) => {
        const body = await parseBody(request, zRefreshRequest)
        return respond(zRefreshResponse, backend.refresh(body), 200, request, backend)
      }),
    ),
    http.post(
      '/api/user/auth/logout',
      handle(backend, async ({ request }) => {
        const body = await parseBody(request, zLogoutRequest)
        backend.logout(body)
        return new HttpResponse(null, { status: 204, headers: headers(request, backend) })
      }),
    ),
    http.get('/api/user/.well-known/jwks.json', () =>
      respond(zJwksResponse, { keys: [MOCK_JWK] }, 200, undefined, backend),
    ),
    http.get(
      '/api/user/users/me',
      handle(backend, ({ request }) =>
        respond(zUserResponse, backend.getMe(bearer(request)), 200, request, backend),
      ),
    ),
    http.patch(
      '/api/user/users/me',
      handle(backend, async ({ request }) => {
        const body = await parseBody(request, zUpdateMeRequest)
        return respond(
          zUserResponse,
          backend.updateMe(bearer(request), body),
          200,
          request,
          backend,
        )
      }),
    ),
    http.delete(
      '/api/user/users/me',
      handle(backend, async ({ request }) => {
        const body = await parseBody(request, zDeleteMeRequest)
        backend.deleteMe(bearer(request), body)
        return new HttpResponse(null, { status: 204, headers: headers(request, backend) })
      }),
    ),

    // --- Daily Service ---------------------------------------------------
    http.get(
      '/api/daily/health',
      handle(backend, ({ request }) =>
        json({ status: 'ok', service: 'daily-service' }, 200, headers(request, backend)),
      ),
    ),
    http.get(
      '/api/daily/dailies/difficulties',
      handle(backend, ({ request }) =>
        respond(
          zDailyDifficultiesResponse,
          backend.listDifficulties(bearer(request)),
          200,
          request,
          backend,
        ),
      ),
    ),
    http.get(
      '/api/daily/dailies/history',
      handle(backend, ({ request }) =>
        respond(
          zDailyHistoryResponse,
          backend.listDailyHistory(bearer(request), {
            ...cursorOf(request),
            ...limitOf(request),
          }),
          200,
          request,
          backend,
        ),
      ),
    ),
    http.get(
      '/api/daily/dailies',
      handle(backend, ({ request }) =>
        respond(
          zDailyListResponse,
          backend.listDailies(bearer(request), {
            ...statusOf(request),
            ...fromOf(request),
            ...toOf(request),
          }),
          200,
          request,
          backend,
        ),
      ),
    ),
    http.post(
      '/api/daily/dailies',
      handle(backend, async ({ request }) => {
        const body = await parseBody(request, zCreateDailyRequest)
        return respond(
          zDailyCreateResponse,
          backend.createDaily(bearer(request), body),
          201,
          request,
          backend,
        )
      }),
    ),
    http.post(
      '/api/daily/dailies/:id/complete',
      handle(backend, ({ request, params }) =>
        respond(
          zDailyCompleteResponse,
          backend.completeDaily(bearer(request), String(params.id)),
          200,
          request,
          backend,
        ),
      ),
    ),
    http.get(
      '/api/daily/dailies/:id',
      handle(backend, ({ request, params }) =>
        respond(
          zDailyGetResponse,
          backend.getDaily(bearer(request), String(params.id)),
          200,
          request,
          backend,
        ),
      ),
    ),
    http.patch(
      '/api/daily/dailies/:id',
      handle(backend, async ({ request, params }) => {
        const body = await parseBody(request, zUpdateDailyRequest)
        return respond(
          zDailyUpdateResponse,
          backend.updateDaily(bearer(request), String(params.id), body),
          200,
          request,
          backend,
        )
      }),
    ),
    http.delete(
      '/api/daily/dailies/:id',
      handle(backend, ({ request, params }) => {
        backend.deleteDaily(bearer(request), String(params.id))
        return new HttpResponse(null, { status: 204, headers: headers(request, backend) })
      }),
    ),

    // --- Ship Service ----------------------------------------------------
    http.get(
      '/api/ship/health',
      handle(backend, ({ request }) =>
        json({ status: 'ok', service: 'ship-service' }, 200, headers(request, backend)),
      ),
    ),
    http.get(
      '/api/ship/ships/me',
      handle(backend, ({ request }) =>
        respond(zShipGetMeResponse, backend.getShip(bearer(request)), 200, request, backend),
      ),
    ),
    http.post(
      '/api/ship/ships/repair',
      handle(backend, ({ request }) =>
        respond(zShipRepairResponse, backend.repairShip(bearer(request)), 200, request, backend),
      ),
    ),

    // --- Expedition Service ----------------------------------------------
    http.get(
      '/api/expedition/health',
      handle(backend, ({ request }) =>
        json({ status: 'ok', service: 'expedition-service' }, 200, headers(request, backend)),
      ),
    ),
    http.get(
      '/api/expedition/expeditions/current',
      handle(backend, ({ request }) =>
        respond(
          zExpeditionCurrentResponse,
          backend.getCurrentExpedition(bearer(request)),
          200,
          request,
          backend,
        ),
      ),
    ),
    http.get(
      '/api/expedition/expeditions/quote',
      handle(backend, ({ request }) =>
        respond(
          zExpeditionQuoteResponse,
          backend.getExpeditionQuote(bearer(request), numberQueryOf(request, 'materials_invested')),
          200,
          request,
          backend,
        ),
      ),
    ),
    http.get(
      '/api/expedition/expeditions',
      handle(backend, ({ request }) =>
        respond(
          zExpeditionListResponse,
          backend.listExpeditions(bearer(request), {
            ...limitOf(request),
            ...offsetOf(request),
          }),
          200,
          request,
          backend,
        ),
      ),
    ),
    http.post(
      '/api/expedition/expeditions/launch',
      handle(backend, async ({ request }) => {
        const body = await parseBody(request, zExpeditionLaunchBody)
        return respond(
          zExpeditionLaunchResponse,
          backend.launchExpedition(bearer(request), {
            materials_invested: Number(body.materials_invested),
          }),
          201,
          request,
          backend,
        )
      }),
    ),
    http.get(
      '/api/expedition/expeditions/:id',
      handle(backend, ({ request, params }) =>
        respond(
          zExpeditionGetResponse,
          backend.getExpedition(bearer(request), String(params.id)),
          200,
          request,
          backend,
        ),
      ),
    ),

    // --- Strict unhandled API failure ------------------------------------
    http.all(/\/api\/.+/u, ({ request }) =>
      HttpResponse.json(
        {
          error: {
            code: 'MOCK_UNHANDLED_REQUEST',
            message: `No mock handler for ${request.method} ${new URL(request.url).pathname}.`,
          },
        },
        { status: 501 },
      ),
    ),
  ]
}

/**
 * Strict unhandled-request policy for MSW `setupWorker`/`setupServer`: any
 * `/api/**` request that falls through a handler is an error, while assets and
 * Vite traffic pass through untouched.
 */
export function onUnhandledMockRequest(request: Request): void {
  if (new URL(request.url).pathname.startsWith(API_PREFIX)) {
    throw new Error(
      `[mocks] Unhandled ${request.method} ${new URL(request.url).pathname}. ` +
        'Add a handler or select a scenario that models it.',
    )
  }
}

const MOCK_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  kid: 'mock-key',
  use: 'sig',
  alg: 'EdDSA',
} as const

function handle(backend: MockBackend, resolver: HttpResponseResolver): HttpResponseResolver {
  return async (context) => {
    await backend.awaitResponseDelay()
    try {
      return await resolver(context)
    } catch (error: unknown) {
      return errorResponse(error, context.request, backend)
    }
  }
}

function json(
  body: JsonBodyType,
  status = 200,
  responseHeaders?: Record<string, string>,
): Response {
  return HttpResponse.json(
    body,
    responseHeaders === undefined ? { status } : { status, headers: responseHeaders },
  )
}

function headers(request: Request, backend: MockBackend): Record<string, string> {
  return { 'X-Request-Id': request.headers.get('X-Request-Id') ?? backend.nextRequestId() }
}

function respond(
  schema: ZodType,
  data: unknown,
  status: number,
  request: Request | undefined,
  backend: MockBackend,
): Response {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new MockApiError(
      500,
      'MOCK_RESPONSE_INVALID',
      `Mock response does not satisfy its generated schema: ${parsed.error.message}`,
    )
  }
  // Validate with the generated schema, but serialize the original JSON-safe
  // value: some generated int64 schemas coerce to bigint, which cannot be
  // JSON-encoded.
  return HttpResponse.json(data as JsonBodyType, {
    status,
    headers: request === undefined ? {} : headers(request, backend),
  })
}

function errorResponse(error: unknown, request: Request, backend: MockBackend): Response {
  if (error instanceof MockApiError) {
    return HttpResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fieldErrors === undefined
            ? {}
            : { details: { field_errors: error.fieldErrors } }),
        },
      },
      { status: error.status, headers: headers(request, backend) },
    )
  }
  return HttpResponse.json(
    {
      error: {
        code: 'MOCK_INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unexpected mock failure.',
      },
    },
    { status: 500, headers: headers(request, backend) },
  )
}

async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    throw new MockApiError(422, 'VALIDATION_FAILED', 'The request body is not valid JSON.', {
      body: 'must be valid JSON',
    })
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new MockApiError(422, 'VALIDATION_FAILED', 'The request body is invalid.', {
      body: parsed.error.issues.at(0)?.message ?? 'invalid',
    })
  }
  return parsed.data
}

function bearer(request: Request): string | undefined {
  const header = request.headers.get('Authorization')
  const match = header === null ? null : /^Bearer (.+)$/u.exec(header)
  return match?.[1]
}

function cursorOf(request: Request): { cursor?: string } {
  const value = new URL(request.url).searchParams.get('cursor')
  return value === null ? {} : { cursor: value }
}

function numberQueryOf(request: Request, key: string): number {
  const value = new URL(request.url).searchParams.get(key)
  const parsed = value === null ? Number.NaN : Number.parseFloat(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function statusOf(request: Request): { status?: string } {
  const value = new URL(request.url).searchParams.get('status')
  return value === null ? {} : { status: value }
}

function fromOf(request: Request): { from?: string } {
  const value = new URL(request.url).searchParams.get('from')
  return value === null ? {} : { from: value }
}

function toOf(request: Request): { to?: string } {
  const value = new URL(request.url).searchParams.get('to')
  return value === null ? {} : { to: value }
}

function limitOf(request: Request): { limit?: number } {
  const value = new URL(request.url).searchParams.get('limit')
  const parsed = value === null ? undefined : Number.parseInt(value, 10)
  return parsed === undefined || Number.isNaN(parsed) ? {} : { limit: parsed }
}

function offsetOf(request: Request): { offset?: number } {
  const value = new URL(request.url).searchParams.get('offset')
  const parsed = value === null ? undefined : Number.parseInt(value, 10)
  return parsed === undefined || Number.isNaN(parsed) ? {} : { offset: parsed }
}
