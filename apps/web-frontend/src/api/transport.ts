import { z } from 'zod'

export type ApiService = 'user' | 'daily' | 'ship' | 'expedition'

/**
 * Transport-owned schema for the shared backend error envelope
 * (docs/adr/0006-shared-http-error-envelope-and-request-id.md). The envelope is
 * cross-cutting infrastructure, so the domain-neutral transport owns it rather
 * than importing a feature's generated contract.
 */
const zApiErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z
      .object({
        field_errors: z.record(z.string(), z.string()),
      })
      .optional(),
  }),
})

export type ApiErrorEnvelope = z.infer<typeof zApiErrorEnvelope>

type ApiErrorBase = {
  readonly requestId: string | undefined
}

export type ApiNetworkError = ApiErrorBase & {
  readonly kind: 'network'
  readonly cause: unknown
}

export type ApiAbortError = ApiErrorBase & {
  readonly kind: 'aborted'
}

export type ApiInvalidResponseError = ApiErrorBase & {
  readonly kind: 'invalid_response'
  readonly status: number
  readonly cause: unknown
}

export type ApiHttpError = ApiErrorBase & {
  readonly kind: 'api'
  readonly status: number
  readonly code: string
  readonly message: string
  readonly fieldErrors: Readonly<Record<string, string>> | undefined
}

export type ApiTransportError =
  ApiNetworkError | ApiAbortError | ApiInvalidResponseError | ApiHttpError

export type ApiQuery = Readonly<Record<string, string | number | boolean | undefined>>

export type ApiRequest<T> = {
  readonly service: ApiService
  readonly path: `/${string}`
  readonly response: z.ZodType<T>
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly query?: ApiQuery
  readonly body?: unknown
  readonly signal?: AbortSignal | undefined
}

export type ApiTransportOptions = {
  readonly getAccessToken?: () => string | undefined
  readonly fetch?: typeof globalThis.fetch
  readonly createRequestId?: () => string
}

const servicePrefixes: Readonly<Record<ApiService, string>> = {
  user: '/api/user',
  daily: '/api/daily',
  ship: '/api/ship',
  expedition: '/api/expedition',
}

export class ApiTransport {
  private readonly getAccessToken: () => string | undefined
  private readonly fetch: typeof globalThis.fetch
  private readonly createRequestId: () => string

  public constructor(options: ApiTransportOptions = {}) {
    this.getAccessToken = options.getAccessToken ?? (() => undefined)
    this.fetch = options.fetch ?? globalThis.fetch
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID())
  }

  public async request<T>(request: ApiRequest<T>): Promise<T> {
    const requestId = this.createRequestId()

    try {
      const init: RequestInit = {
        method: request.method ?? 'GET',
        headers: this.createHeaders(requestId, request.body),
      }
      if (request.body !== undefined) {
        init.body = JSON.stringify(request.body)
      }
      if (request.signal !== undefined) {
        init.signal = request.signal
      }
      const response = await this.fetch(
        this.createUrl(request.service, request.path, request.query),
        init,
      )

      const responseRequestId = response.headers.get('X-Request-Id') ?? requestId
      if (!response.ok) {
        throw asError(await this.createApiError(response, responseRequestId))
      }

      if (response.status === 204) {
        return undefined as T
      }

      const body = await this.readJson(response, responseRequestId)
      const parsed = request.response.safeParse(body)
      if (!parsed.success) {
        throw asError(this.invalidResponse(response.status, responseRequestId, parsed.error))
      }

      return parsed.data
    } catch (error: unknown) {
      if (isApiTransportError(error)) {
        throw error
      }
      if (request.signal?.aborted || isAbortError(error)) {
        throw asError({ kind: 'aborted', requestId } satisfies ApiAbortError)
      }
      throw asError({ kind: 'network', requestId, cause: error } satisfies ApiNetworkError)
    }
  }

  private createUrl(service: ApiService, path: `/${string}`, query: ApiQuery | undefined): string {
    const parameters = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        parameters.set(key, String(value))
      }
    }
    const search = parameters.toString()
    return `${servicePrefixes[service]}${path}${search === '' ? '' : `?${search}`}`
  }

  private createHeaders(requestId: string, body: unknown): Headers {
    const headers = new Headers({ Accept: 'application/json', 'X-Request-Id': requestId })
    const accessToken = this.getAccessToken()
    if (accessToken !== undefined) {
      headers.set('Authorization', `Bearer ${accessToken}`)
    }
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json')
    }
    return headers
  }

  private async createApiError(response: Response, requestId: string): Promise<ApiTransportError> {
    const body = await this.readJson(response, requestId)
    const parsed = zApiErrorEnvelope.safeParse(body)
    if (!parsed.success) {
      return this.invalidResponse(response.status, requestId, parsed.error)
    }

    return {
      kind: 'api',
      status: response.status,
      requestId,
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      fieldErrors: parsed.data.error.details?.field_errors,
    }
  }

  private async readJson(response: Response, requestId: string): Promise<unknown> {
    const contentType = response.headers.get('Content-Type')
    if (contentType === null || !contentType.toLowerCase().includes('application/json')) {
      throw asError(
        this.invalidResponse(response.status, requestId, new Error('Expected a JSON response')),
      )
    }

    try {
      return await response.json()
    } catch (error: unknown) {
      throw asError(this.invalidResponse(response.status, requestId, error))
    }
  }

  private invalidResponse(
    status: number,
    requestId: string,
    cause: unknown,
  ): ApiInvalidResponseError {
    return { kind: 'invalid_response', status, requestId, cause }
  }
}

export function isApiTransportError(error: unknown): error is ApiTransportError {
  if (typeof error !== 'object' || error === null || !('kind' in error)) {
    return false
  }
  return ['network', 'aborted', 'invalid_response', 'api'].includes(String(error.kind))
}

/**
 * Narrows a transport error to the HTTP API error for a specific backend code.
 * Feature adapters branch on `code` (spec §7), never status.
 */
export function isApiHttpError(error: unknown, code: string): error is ApiHttpError {
  return isApiTransportError(error) && error.kind === 'api' && error.code === code
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function asError(error: ApiTransportError): Error & ApiTransportError {
  return Object.assign(new Error(error.kind), error)
}
