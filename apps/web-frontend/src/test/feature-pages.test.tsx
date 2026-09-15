process.env.TZ = 'UTC'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import { ExpeditionDetailPage } from '@/features/expeditions'
import { FIXED_MOCK_EPOCH_MS } from '@/mocks/fixtures'
import { createMockTestServer, onUnhandledMockRequest } from '@/mocks'
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
  window.localStorage.clear()
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
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

function renderStandalone(element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('domain recovery', () => {
  it('recovers a missing Daily id inside the shell without redirecting', async () => {
    renderAppAt('/dailies/00000000-0000-4000-8000-000000000099/edit')

    expect(
      await screen.findByRole('heading', { level: 2, name: 'This Daily does not exist' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Daily not found' })).toBeInTheDocument()
    // The shell stays on the edit route; the way back is an explicit link.
    expect(screen.getByRole('link', { name: 'Back to Dailies' })).toBeInTheDocument()
  })

  it('describes a missing Expedition id without redirecting', () => {
    renderStandalone(<ExpeditionDetailPage />)

    expect(screen.getByText(/Expedition unknown/)).toBeInTheDocument()
  })
})
