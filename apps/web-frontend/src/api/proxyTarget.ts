import { z } from 'zod'

/**
 * Server-only Vite proxy origins, validated with Zod at the environment trust
 * boundary (docs/specs/web-frontend.md §3.1/§7).
 *
 * These variables are intentionally NOT prefixed with `VITE_` so Vite never
 * inlines them into the browser bundle. See `apps/web-frontend/.env.example`.
 * The keys and local defaults mirror the service ports in
 * `docs/specs/web-frontend.md` §7.
 */
const serviceOrigin = z
  .url({ protocol: /^https?$/, error: 'must be an absolute http(s) service origin' })
  .refine(isBareOrigin, 'must be an absolute http(s) service origin without credentials or a path')
  .transform((value) => new URL(value).origin)

function isBareOrigin(value: string): boolean {
  try {
    const target = new URL(value)
    return (
      target.username === '' &&
      target.password === '' &&
      target.pathname === '/' &&
      target.search === '' &&
      target.hash === ''
    )
  } catch {
    return false
  }
}

const proxyEnvironmentSchema = z.object({
  USER_SERVICE_PROXY_TARGET: z.string().default('http://localhost:8081').pipe(serviceOrigin),
  DAILY_SERVICE_PROXY_TARGET: z.string().default('http://localhost:8082').pipe(serviceOrigin),
  SHIP_SERVICE_PROXY_TARGET: z.string().default('http://localhost:8083').pipe(serviceOrigin),
  EXPEDITION_SERVICE_PROXY_TARGET: z.string().default('http://localhost:8084').pipe(serviceOrigin),
})

export type ProxyEnvironment = z.infer<typeof proxyEnvironmentSchema>

/**
 * Parses and validates the server-only proxy environment. Invalid values fail
 * loudly with the offending variable name instead of silently proxying to a
 * malformed origin.
 */
export function parseProxyEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): ProxyEnvironment {
  const parsed = proxyEnvironmentSchema.safeParse(env)
  if (!parsed.success) {
    const issue = parsed.error.issues.at(0)
    const envKey = issue?.path.join('.') || 'Proxy configuration'
    throw new Error(`${envKey} ${issue?.message ?? 'is invalid'}`)
  }
  return parsed.data
}
