process.env.TZ = 'UTC'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import { createMockTestServer, onUnhandledMockRequest } from '@/mocks'
import { FIXED_MOCK_EPOCH_MS } from '@/mocks/fixtures'
import { renderAppAt } from '@/test/renderApp'

const server = createMockTestServer({ scenario: 'established-player' })

beforeAll(() => {
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
})
afterEach(() => {
  server.server.resetHandlers()
  server.reset('established-player')
  vi.useRealTimers()
})
afterAll(() => {
  server.stop()
})
beforeEach(async () => {
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
  window.localStorage.clear()
  const response = await fetch('/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
  })
  const body = (await response.json()) as { refresh_token: string }
  window.localStorage.setItem(
    SESSION_REFRESH_STORAGE_KEY,
    JSON.stringify({ version: 1, refreshToken: body.refresh_token }),
  )
})

it('offers one Create Daily link on a populated date', async () => {
  renderAppAt('/dailies?date=2026-01-15')
  await screen.findByRole('heading', { name: 'Calibrate sensors' })
  expect(screen.getByRole('link', { name: 'Create Daily' })).toHaveAttribute('href', '/dailies/new')
})

it('refreshes a recently viewed date and focuses the Daily created through its entry point', async () => {
  const user = userEvent.setup()
  renderAppAt('/dailies')
  await screen.findByRole('heading', { name: 'Calibrate sensors' })
  await user.click(screen.getByRole('link', { name: 'Create Daily' }))
  await user.type(await screen.findByLabelText('Title'), 'Inspect the navigation log')
  await user.click(screen.getByRole('button', { name: 'Create Daily' }))
  expect(await screen.findByRole('heading', { name: 'Inspect the navigation log' })).toHaveFocus()
  expect(screen.getByText('Created Daily "Inspect the navigation log".')).toBeInTheDocument()
})

it.each([
  ['/dailies?date=2026-01-16', 'No Dailies'],
  ['/dailies?date=2026-01-15&status=PENDING', 'Calibrate sensors'],
  ['/dailies?date=2026-01-15&status=COMPLETED', 'Hydrate the coolant loop'],
  ['/dailies?date=2026-01-16&status=COMPLETED', 'No Dailies'],
])('keeps one Create Daily action at %s', async (route, heading) => {
  renderAppAt(route)
  await screen.findByRole('heading', { name: heading })
  expect(screen.getByRole('link', { name: 'Create Daily' })).toHaveAttribute('href', '/dailies/new')
})

it('keeps creation available while loading and when the list is unavailable', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  server.server.use(
    http.get('/api/daily/dailies', async () => {
      await gate
      return HttpResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'List unavailable.' } },
        { status: 500 },
      )
    }),
  )
  renderAppAt('/dailies')
  expect(await screen.findByRole('link', { name: 'Create Daily' })).toBeInTheDocument()
  release()
  await screen.findByRole('heading', { name: 'Dailies are unavailable' })
  expect(screen.getByRole('link', { name: 'Create Daily' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
})

it('keeps creation available while preparing with section-specific Retry', async () => {
  server.server.use(
    http.get('/api/daily/dailies', () =>
      HttpResponse.json(
        { error: { code: 'DAILY_PLAYER_NOT_READY', message: 'Preparing.' } },
        { status: 503 },
      ),
    ),
  )
  renderAppAt('/dailies')
  await screen.findByRole('heading', { name: 'Preparing your Dailies' })
  expect(screen.getByRole('link', { name: 'Create Daily' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
})

it('keeps creation and Retry available alongside stale rows', async () => {
  const user = userEvent.setup()
  renderAppAt('/dailies')
  await screen.findByRole('heading', { name: 'Calibrate sensors' })
  server.server.use(
    http.get('/api/daily/dailies', () =>
      HttpResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'List unavailable.' } },
        { status: 500 },
      ),
    ),
  )
  await user.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
  await screen.findByText('Showing the last confirmed Dailies — refresh failed.')
  expect(screen.getByRole('link', { name: 'Create Daily' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Calibrate sensors' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry refresh' })).toBeInTheDocument()
})
