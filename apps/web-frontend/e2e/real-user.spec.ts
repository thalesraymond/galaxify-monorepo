import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import {
  zAuthSessionResponse,
  zRefreshResponse,
  zUserHealthResponse,
  zUserResponse,
} from '../src/api/generated/user/zod.gen'

import { SESSION_REFRESH_STORAGE_KEY } from './session'

/**
 * Real-stack User Service convergence (issue #162).
 *
 * Exercises the browser session/Profile capability against the REAL
 * user-service routes behind the Vite dev proxy (real mode), not MSW. Every
 * exchange is a live request to `REAL_STACK_BASE_URL` (the app) and through
 * its proxy to the real user-service on :8081.
 *
 * Environment (all gated — this file is a no-op unless `RUN_REAL_STACK=1`):
 *   RUN_REAL_STACK=1
 *   REAL_STACK_BASE_URL   http://127.0.0.1:5173 (default; `npm run dev` real mode)
 *   USER_SERVICE_DIR      apps/user-service (default: derived from this file)
 *
 * Prerequisites (offline, local only):
 *   1. Local infra: postgres `user_db` :5431 + rabbitmq :5672 (docker compose).
 *   2. `apps/user-service/.env` present, `./goose.sh up` applied, service built
 *      (`go build -o bin/ .`) and running (`bin/user-service` on :8081).
 *   3. Real-mode Vite dev server: `npm run dev -- --host 127.0.0.1 --port 5173
 *      --strictPort` (the browser prefixes proxy to :8081).
 *
 * Run:
 *   RUN_REAL_STACK=1 npx playwright test e2e/real-user.spec.ts --project=chromium
 *
 * The suite is serial: the outage test stops and restarts the real service and
 * must run last. Each scenario uses a unique account email so runs are
 * repeatable against a persistent local database.
 *
 * Fault injection is limited to the browser network boundary and is always
 * documented inline: one fabricated 401 (reactive refresh) and a process
 * kill/restart (retryable outage). Everything after those injections is a real
 * exchange.
 */
const RUN_REAL_STACK = process.env.RUN_REAL_STACK === '1'
const REAL_BASE_URL = process.env.REAL_STACK_BASE_URL ?? 'http://127.0.0.1:5173'
const userServiceDir =
  process.env.USER_SERVICE_DIR ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../user-service')

const PASSWORD = 'password123'

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@galaxify.test`
}

/** Usernames persist in the real database, so every scenario uses a run-unique one. */
function uniqueUsername(prefix: string): string {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return `${prefix}_${suffix}`.slice(0, 30)
}

type RawFetchResult = {
  readonly status: number
  readonly requestId: string | null
  readonly body: unknown
}

/** Performs a real fetch through the Vite proxy from inside the page. */
async function apiFetch(
  page: Page,
  urlPath: string,
  options: { readonly method?: string; readonly body?: unknown; readonly bearer?: string } = {},
): Promise<RawFetchResult> {
  return page.evaluate(
    async ({ baseUrl, urlPath, method, body, bearer }) => {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
      }
      if (bearer !== undefined) {
        headers.Authorization = `Bearer ${bearer}`
      }
      const response = await fetch(new URL(urlPath, baseUrl).toString(), {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
      })
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = text === '' ? undefined : (JSON.parse(text) as unknown)
      } catch {
        parsed = text
      }
      return {
        status: response.status,
        requestId: response.headers.get('X-Request-Id'),
        body: parsed,
      }
    },
    {
      baseUrl: REAL_BASE_URL,
      urlPath,
      method: options.method ?? 'GET',
      body: options.body,
      bearer: options.bearer,
    },
  )
}

async function signupThroughUi(page: Page, email: string, username: string): Promise<void> {
  await page.goto('/signup')
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
}

function readStoredRefreshToken(page: Page): Promise<string | null> {
  return page.evaluate(({ storageKey }) => window.localStorage.getItem(storageKey), {
    storageKey: SESSION_REFRESH_STORAGE_KEY,
  })
}

/**
 * Lands on the app so `apiFetch` runs from a same-origin document (an
 * `about:blank` page would be an opaque origin and its fetches CORS-blocked).
 */
async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test.describe('real user-service convergence (RUN_REAL_STACK=1)', () => {
  test.skip(!RUN_REAL_STACK, 'set RUN_REAL_STACK=1 to run the real-stack suite (see file header)')

  test.use({ baseURL: REAL_BASE_URL })

  // Detached user-service processes this suite respawns during the outage
  // scenario are tracked here so an aborted run can never orphan a live
  // service: afterAll terminates every child we spawned, plus any service
  // process the outage test restarted.
  const spawnedServices: ReturnType<typeof spawn>[] = []

  test.afterAll(() => {
    for (const child of spawnedServices) {
      try {
        child.kill('SIGTERM')
      } catch {
        // already exited
      }
    }
  })

  test('wire contract: every user route conforms to the generated OpenAPI shapes', async ({
    page,
  }) => {
    await openApp(page)
    // Precondition: the app proxy must be able to reach the real service.
    const health = await apiFetch(page, '/api/user/health')
    expect(health.status).toBe(200)
    expect(health.requestId).not.toBeNull()
    expect(zUserHealthResponse.safeParse(health.body).success).toBe(true)

    // Signup: 201, contract-parseable session envelope, X-Request-Id echoed.
    const signupEmail = uniqueEmail('wire-signup')
    const signup = await apiFetch(page, '/api/user/users', {
      method: 'POST',
      body: { email: signupEmail, username: uniqueUsername('wire_user'), password: PASSWORD },
    })
    expect(signup.status).toBe(201)
    expect(signup.requestId).not.toBeNull()
    const session = zAuthSessionResponse.parse(signup.body)
    expect(zUserResponse.safeParse(session.user).success).toBe(true)
    expect(session.access_token.length).toBeGreaterThan(20)
    expect(session.refresh_token.length).toBeGreaterThan(20)

    // Authenticated read: GET /users/me returns the identity, UTC RFC3339 datetimes.
    const me = await apiFetch(page, '/api/user/users/me', { bearer: session.access_token })
    expect(me.status).toBe(200)
    expect(zUserResponse.safeParse(me.body).success).toBe(true)
    expect((me.body as { email: string }).email).toBe(signupEmail)

    // Profile update: valid username 200; invalid username 422 + field_errors.
    const renamed = uniqueUsername('wire_renamed')
    const patched = await apiFetch(page, '/api/user/users/me', {
      method: 'PATCH',
      bearer: session.access_token,
      body: { username: renamed },
    })
    expect(patched.status).toBe(200)
    expect((patched.body as { username: string }).username).toBe(renamed)
    const invalid = await apiFetch(page, '/api/user/users/me', {
      method: 'PATCH',
      bearer: session.access_token,
      body: { username: 'ab' },
    })
    expect(invalid.status).toBe(422)
    expect((invalid.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED')

    // Deletion: wrong password 401 USER_INVALID_CREDENTIALS; correct 204.
    const wrongDelete = await apiFetch(page, '/api/user/users/me', {
      method: 'DELETE',
      bearer: session.access_token,
      body: { password: 'not-the-password' },
    })
    expect(wrongDelete.status).toBe(401)
    expect((wrongDelete.body as { error: { code: string } }).error.code).toBe(
      'USER_INVALID_CREDENTIALS',
    )
    const deleteMe = await apiFetch(page, '/api/user/users/me', {
      method: 'DELETE',
      bearer: session.access_token,
      body: { password: PASSWORD },
    })
    expect(deleteMe.status).toBe(204)
  })

  test('refresh single-use: consume once, reuse revokes the family', async ({ page }) => {
    await openApp(page)
    const signup = await apiFetch(page, '/api/user/users', {
      method: 'POST',
      body: {
        email: uniqueEmail('wire-single'),
        username: uniqueUsername('wire_single'),
        password: PASSWORD,
      },
    })
    expect(signup.status).toBe(201)
    const session = zAuthSessionResponse.parse(signup.body)

    // First rotation consumes the presented token and issues a replacement.
    const rotated = await apiFetch(page, '/api/user/auth/refresh', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
    })
    expect(rotated.status).toBe(200)
    const replacement = zRefreshResponse.parse(rotated.body)
    expect(replacement.refresh_token).not.toBe(session.refresh_token)

    // Reuse of the consumed token is terminal: 401 AUTH_INVALID_TOKEN.
    const reused = await apiFetch(page, '/api/user/auth/refresh', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
    })
    expect(reused.status).toBe(401)
    expect((reused.body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_TOKEN')

    // Family revocation: even the replacement token is now dead.
    const replacementRetry = await apiFetch(page, '/api/user/auth/refresh', {
      method: 'POST',
      body: { refresh_token: replacement.refresh_token },
    })
    expect(replacementRetry.status).toBe(401)
    expect((replacementRetry.body as { error: { code: string } }).error.code).toBe(
      'AUTH_INVALID_TOKEN',
    )
  })

  test('logout: refresh_token body, no access token required, 204, family revoked', async ({
    page,
  }) => {
    await openApp(page)
    const signup = await apiFetch(page, '/api/user/users', {
      method: 'POST',
      body: {
        email: uniqueEmail('wire-logout'),
        username: uniqueUsername('wire_logout'),
        password: PASSWORD,
      },
    })
    expect(signup.status).toBe(201)
    const session = zAuthSessionResponse.parse(signup.body)

    // No Authorization header and only a refresh_token body: 204.
    const logout = await page.evaluate(
      async ({ refreshToken }) => {
        const requestHeaders = new Headers({ 'Content-Type': 'application/json' })
        const response = await fetch('/api/user/auth/logout', {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({ refresh_token: refreshToken }),
        })
        return {
          status: response.status,
          sentAuthorization: requestHeaders.has('Authorization'),
          requestId: response.headers.get('X-Request-Id'),
        }
      },
      { refreshToken: session.refresh_token },
    )
    expect(logout.status).toBe(204)
    expect(logout.sentAuthorization).toBe(false)
    expect(logout.requestId).not.toBeNull()

    // The revoked family cannot refresh any more.
    const after = await apiFetch(page, '/api/user/auth/refresh', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
    })
    expect(after.status).toBe(401)
    expect((after.body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_TOKEN')
  })

  test('login: normalized email authenticates a returning Player', async ({ page }) => {
    await openApp(page)
    const email = uniqueEmail('login-normalize')
    const signup = await apiFetch(page, '/api/user/users', {
      method: 'POST',
      body: { email, username: uniqueUsername('login_user'), password: PASSWORD },
    })
    expect(signup.status).toBe(201)

    const upperEmail = email.toUpperCase()
    const login = await apiFetch(page, '/api/user/auth/login', {
      method: 'POST',
      body: { email: upperEmail, password: PASSWORD },
    })
    expect(login.status).toBe(200)
    const session = zAuthSessionResponse.parse(login.body)
    expect(session.user.email).toBe(email)
  })

  test('signup enters the app, persists only the refresh token, and bootstrap rotates on reload', async ({
    page,
  }) => {
    const email = uniqueEmail('ui-bootstrap')
    await signupThroughUi(page, email, uniqueUsername('ui_bootstrap'))

    // Exclusivity: the only persisted key is the versioned refresh-token key.
    // Anything else (an access token, cache, or drafts) would fail the equality.
    const keys = await page.evaluate(() =>
      Array.from({ length: window.localStorage.length }, (_, index) =>
        window.localStorage.key(index),
      ),
    )
    expect(keys).toEqual([SESSION_REFRESH_STORAGE_KEY])

    const refreshRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/user/auth/refresh')) {
        refreshRequests.push(request.url())
      }
    })
    const beforeReload = await readStoredRefreshToken(page)
    expect(beforeReload).not.toBeNull()

    // Reload restores the dashboard through a real startup rotation.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
    const afterReload = await readStoredRefreshToken(page)
    expect(afterReload).not.toBeNull()
    expect(afterReload).not.toBe(beforeReload)
    expect(refreshRequests.length).toBeGreaterThanOrEqual(1)

    // The consumed startup token is single-use: refreshing with it is terminal.
    const consumed = JSON.parse(beforeReload ?? '{}') as { refreshToken: string }
    const reuse = await apiFetch(page, '/api/user/auth/refresh', {
      method: 'POST',
      body: { refresh_token: consumed.refreshToken },
    })
    expect(reuse.status).toBe(401)
  })

  test('threshold gating: a fresh token does not rotate before authenticated work', async ({
    page,
  }) => {
    await signupThroughUi(page, uniqueEmail('ui-gating'), uniqueUsername('ui_gating'))

    let refreshCount = 0
    page.on('request', (request) => {
      if (request.url().includes('/api/user/auth/refresh')) {
        refreshCount += 1
      }
    })

    // Real activity plus an authenticated read right after signup: the access
    // token is far from expiry, so the 60s threshold must not trigger a
    // premature rotation.
    await page.keyboard.press('Tab')
    await page.getByRole('button', { name: 'Account' }).first().click()
    await page.getByRole('menuitem', { name: 'Profile' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
    expect(refreshCount).toBe(0)
  })

  test('reactive refresh: AUTH_INVALID_TOKEN triggers exactly one real rotation and one replay', async ({
    page,
  }) => {
    const username = uniqueUsername('ui_reactive')
    await signupThroughUi(page, uniqueEmail('ui-reactive'), username)

    let refreshCount = 0
    const patchAttempts: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/user/auth/refresh')) {
        refreshCount += 1
      }
      if (request.method() === 'PATCH' && request.url().endsWith('/users/me')) {
        patchAttempts.push(request.url())
      }
    })

    await page.getByRole('button', { name: 'Account' }).first().click()
    await page.getByRole('menuitem', { name: 'Profile' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
    await expect(page.getByLabel('Username')).toHaveValue(username)

    // Fault injection at the browser network boundary ONLY: the first PATCH
    // /users/me (a user-triggered mutation, so it has no React Query
    // double-mount/abort race) is answered with an AUTH_INVALID_TOKEN envelope.
    // The refresh (real rotation) and the replay (real exchange) follow.
    let injected = 0
    await page.route('**/api/user/users/me', async (route) => {
      if (route.request().method() === 'PATCH' && injected === 0) {
        injected += 1
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          headers: { 'X-Request-Id': 'reactive-fault-injection' },
          body: JSON.stringify({
            error: { code: 'AUTH_INVALID_TOKEN', message: 'fault-injected invalid token' },
          }),
        })
        return
      }
      await route.continue()
    })

    const updated = uniqueUsername('ui_reactive_v2')
    await page.getByLabel('Username').fill(updated)
    await page.getByRole('button', { name: 'Save username' }).click()

    // The mutation succeeds through exactly one refresh and one replay: the
    // replay is a real PATCH, so the username change persists.
    await expect(page.getByText('Your username was updated.')).toBeAttached()
    expect(injected).toBe(1)
    expect(refreshCount).toBe(1)
    expect(patchAttempts.length).toBe(2)
    await expect(page.getByLabel('Username')).toHaveValue(updated)
  })

  test('cross-tab serialization: concurrent reloads share one refresh lineage without reuse', async ({
    page,
    context,
  }) => {
    await signupThroughUi(page, uniqueEmail('ui-tabs'), uniqueUsername('ui_tabs'))

    let refresh200 = 0
    let refresh401 = 0
    context.on('response', (response) => {
      if (response.url().includes('/api/user/auth/refresh')) {
        if (response.status() === 200) {
          refresh200 += 1
        }
        if (response.status() === 401) {
          refresh401 += 1
        }
      }
    })

    // Second tab bootstraps from the shared local storage (one rotation).
    const secondPage = await context.newPage()
    await secondPage.goto('/dashboard')
    await expect(secondPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

    const preStormToken = await readStoredRefreshToken(page)

    // Concurrent reload: the named Web Lock plus the post-lock storage re-read
    // must serialize the single-use token into two rotations with zero 401s.
    await Promise.all([page.reload(), secondPage.reload()])
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
    await expect(secondPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
    expect(refresh401).toBe(0)
    expect(refresh200).toBe(3) // second tab bootstrap + two serialized reloads

    const finalToken = await readStoredRefreshToken(secondPage)
    expect(finalToken).not.toBeNull()
    expect(finalToken).not.toBe(preStormToken)

    // The live lineage (final stored token) is the only valid one.
    const final = (JSON.parse(finalToken ?? '{}') as { refreshToken: string }).refreshToken
    const live = zRefreshResponse.parse(
      (
        await apiFetch(secondPage, '/api/user/auth/refresh', {
          method: 'POST',
          body: { refresh_token: final },
        })
      ).body,
    )
    expect(live.refresh_token.length).toBeGreaterThan(20)

    // The pre-storm token was consumed exactly once during the storm.
    const old = (JSON.parse(preStormToken ?? '{}') as { refreshToken: string }).refreshToken
    const consumed = await apiFetch(secondPage, '/api/user/auth/refresh', {
      method: 'POST',
      body: { refresh_token: old },
    })
    expect(consumed.status).toBe(401)
  })

  test('terminal invalidity: session ends, clears local state, and syncs every tab', async ({
    page,
    context,
  }) => {
    await signupThroughUi(page, uniqueEmail('ui-terminal'), uniqueUsername('ui_terminal'))
    const secondPage = await context.newPage()
    await secondPage.goto('/dashboard')
    await expect(secondPage.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()

    // Corrupt the persisted refresh token and reload: bootstrap refresh is
    // terminal AUTH_INVALID_TOKEN, so the session ends everywhere.
    await page.evaluate(
      ({ storageKey }) => {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ version: 1, refreshToken: 'terminally-invalid-token' }),
        )
      },
      { storageKey: SESSION_REFRESH_STORAGE_KEY },
    )
    await page.reload()

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.getByText('Your session ended. Sign in again.')).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
    expect(await readStoredRefreshToken(page)).toBeNull()

    // The durable storage signal ends the other tab too, without a reload.
    await expect(secondPage.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible({
      timeout: 10_000,
    })
    expect(await readStoredRefreshToken(secondPage)).toBeNull()
  })

  test('profile: read identity, update username, inline validation and conflict', async ({
    page,
  }) => {
    const email = uniqueEmail('ui-profile')
    const username = uniqueUsername('ui_profile')
    await signupThroughUi(page, email, username)

    // A second account whose username the first Player will try to claim.
    const taken = uniqueUsername('profile_taken')
    const otherSignup = await apiFetch(page, '/api/user/users', {
      method: 'POST',
      body: { email: uniqueEmail('ui-profile-other'), username: taken, password: PASSWORD },
    })
    expect(otherSignup.status).toBe(201)

    await page.getByRole('button', { name: 'Account' }).first().click()
    await page.getByRole('menuitem', { name: 'Profile' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

    // Read-only identity and editable username come from the real /users/me:
    // email, member-since rendered from created_at, and the editable username.
    await expect(page.getByText(email)).toBeVisible()
    await expect(page.getByText('Member since')).toBeVisible()
    await expect(
      page.getByText(
        /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$/,
      ),
    ).toBeVisible()
    await expect(page.getByLabel('Username')).toHaveValue(username)

    // Inline validation error (client and server agree on the 3–30 rule).
    await page.getByLabel('Username').fill('ab')
    await page.getByRole('button', { name: 'Save username' }).click()
    await expect(page.getByText('Username must be 3–30 characters.')).toBeVisible()

    // Conflict against a real unique index -> inline "already taken" error.
    await page.getByLabel('Username').fill(taken)
    await page.getByRole('button', { name: 'Save username' }).click()
    await expect(page.getByText('That username is already taken.')).toBeVisible()

    // Successful update persists through a real PATCH and a real re-read.
    const updated = uniqueUsername('ui_profile_v2')
    await page.getByLabel('Username').fill(updated)
    await page.getByRole('button', { name: 'Save username' }).click()
    await expect(page.getByText('Your username was updated.')).toBeAttached()
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
    await expect(page.getByLabel('Username')).toHaveValue(updated)
  })

  test('logout: revokes the family, clears state, and signs out locally', async ({ page }) => {
    await signupThroughUi(page, uniqueEmail('ui-logout'), uniqueUsername('ui_logout'))
    const stored = await readStoredRefreshToken(page)
    expect(stored).not.toBeNull()
    const refreshToken = (JSON.parse(stored ?? '{}') as { refreshToken: string }).refreshToken

    await page.getByRole('button', { name: 'Account' }).first().click()
    await page.getByRole('menuitem', { name: 'Log out' }).first().click()

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.getByText('You have been signed out.', { exact: true })).toBeVisible()
    expect(await readStoredRefreshToken(page)).toBeNull()

    // Family revocation: the signed-out refresh token can never rotate again.
    const revoked = await apiFetch(page, '/api/user/auth/refresh', {
      method: 'POST',
      body: { refresh_token: refreshToken },
    })
    expect(revoked.status).toBe(401)
    expect((revoked.body as { error: { code: string } }).error.code).toBe('AUTH_INVALID_TOKEN')
  })

  test('deletion: password-confirmed, purges state, and never calls logout', async ({ page }) => {
    const email = uniqueEmail('ui-delete')
    await signupThroughUi(page, email, uniqueUsername('ui_delete'))

    let logoutCalls = 0
    page.on('request', (request) => {
      if (request.url().includes('/api/user/auth/logout')) {
        logoutCalls += 1
      }
    })

    await page.getByRole('button', { name: 'Account' }).first().click()
    await page.getByRole('menuitem', { name: 'Profile' }).click()
    await page.getByRole('button', { name: 'Delete account' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete your account' })
    await dialog.getByLabel('Password').fill(PASSWORD)
    await dialog.getByRole('button', { name: 'Delete account' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible()
    expect(await readStoredRefreshToken(page)).toBeNull()
    expect(logoutCalls).toBe(0)

    // The account no longer exists.
    const login = await apiFetch(page, '/api/user/auth/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    })
    expect(login.status).toBe(401)
    expect((login.body as { error: { code: string } }).error.code).toBe('USER_INVALID_CREDENTIALS')
  })

  test('retryable outage: service failure retains the refresh token and never logs the Player out', async ({
    page,
  }) => {
    test.setTimeout(90_000)

    const binary = path.join(userServiceDir, 'bin', 'user-service')
    test.skip(!existsSync(binary), `user-service binary not found at ${binary}; build it first`)

    await signupThroughUi(page, uniqueEmail('ui-outage'), uniqueUsername('ui_outage'))
    const beforeOutage = await readStoredRefreshToken(page)
    expect(beforeOutage).not.toBeNull()

    // The real service process, matched by its command line so unrelated
    // connections to :8081 are never touched.
    const servicePids = (): number[] => {
      try {
        const out = execSync("pgrep -f 'bin/user-service'", { encoding: 'utf8' }).trim()
        return out === '' ? [] : out.split('\n').map(Number)
      } catch (error: unknown) {
        throw new Error('cannot enumerate the user-service process', { cause: error })
      }
    }

    const waitUntilUnreachable = async (): Promise<void> => {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`${REAL_BASE_URL}/api/user/health`)
          if (!response.ok) {
            return
          }
        } catch {
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error('user-service still reachable after termination')
    }

    const waitUntilHealthy = async (): Promise<void> => {
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`${REAL_BASE_URL}/api/user/health`)
          if (response.ok) {
            return
          }
        } catch {
          // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error('user-service did not become healthy after restart')
    }

    // Stop the real service (process-level outage, not a mock).
    for (const pid of servicePids()) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // already gone
      }
    }
    await waitUntilUnreachable()

    // Reload: bootstrap refresh fails as a transport/network failure, which is
    // retryable, never terminal. The refresh token must survive.
    await page.reload()
    await expect(
      page.getByRole('heading', { level: 1, name: 'We could not restore your session' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0)
    expect(await readStoredRefreshToken(page)).toBe(beforeOutage)

    // Bring the service back and Retry: a real bootstrap rotation restores the
    // session with no sign-out in between. The respawn is tracked so afterAll
    // cleanup terminates it when the suite finishes (or fails).
    const child = spawn('nohup', ['./bin/user-service'], {
      cwd: userServiceDir,
      detached: true,
      stdio: 'ignore',
    })
    spawnedServices.push(child)
    child.unref()
    await waitUntilHealthy()

    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({
      timeout: 20_000,
    })
    const afterOutage = await readStoredRefreshToken(page)
    expect(afterOutage).not.toBeNull()
    expect(afterOutage).not.toBe(beforeOutage)
  })
})
