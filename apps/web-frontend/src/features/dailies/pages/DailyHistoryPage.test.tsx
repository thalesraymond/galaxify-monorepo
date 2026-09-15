process.env.TZ = 'UTC'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import { createMockTestServer, onUnhandledMockRequest } from '@/mocks'
import { FIXED_MOCK_EPOCH_MS, fixedUuid } from '@/mocks/fixtures'
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
  await seedAuthenticatedSession()
})

async function seedAuthenticatedSession(): Promise<void> {
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
}

async function renderHistory(): Promise<void> {
  renderAppAt('/dailies/history')
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Daily history' }),
  ).toBeInTheDocument()
}

describe('/dailies/history', () => {
  it('groups outcomes by occurrence date in descending order', async () => {
    await renderHistory()

    const january14 = await screen.findByRole('region', { name: /January 14, 2026/ })
    expect(screen.getByRole('region', { name: /January 13, 2026/ })).toBeInTheDocument()
    // Descending order: the newer occurrence appears first in the document.
    expect(
      january14.compareDocumentPosition(screen.getByRole('region', { name: /January 13, 2026/ })),
    ).toBe(document.DOCUMENT_POSITION_FOLLOWING)

    // The most recent group comes first; both badges and effects are shown.
    expect(within(january14).getByText('Calibrate sensors')).toBeInTheDocument()
    expect(within(january14).getByText('Completed')).toBeInTheDocument()
    expect(within(january14).getByText('+10 materials')).toBeInTheDocument()
    expect(within(january14).getByText('09:00 (UTC)')).toBeInTheDocument()
    expect(within(january14).getByText('09:30')).toBeInTheDocument()

    const january13 = screen.getByRole('region', { name: /January 13, 2026/ })
    expect(within(january13).getByText('Missed')).toBeInTheDocument()
    expect(within(january13).getByText('−5 hull')).toBeInTheDocument()
  })

  it('collapses long descriptions behind a labelled disclosure', async () => {
    const user = userEvent.setup()
    await renderHistory()

    const descriptions = await screen.findAllByText('Before the next jump')
    expect(descriptions).toHaveLength(2)
    for (const description of descriptions) {
      expect(description).not.toBeVisible()
    }

    const summary = (await screen.findAllByText('Show description'))[0]
    if (summary === undefined) {
      throw new Error('Expected a disclosure summary.')
    }
    await user.click(summary)

    const opened = screen.getAllByText('Before the next jump')[0]
    if (opened === undefined) {
      throw new Error('Expected an opened description.')
    }
    expect(opened).toBeVisible()
  })

  it('shows an empty state when there is no history yet', async () => {
    server.reset('expedition-ready')
    await seedAuthenticatedSession()
    await renderHistory()

    expect(await screen.findByRole('heading', { name: 'No Daily history yet' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create Daily' })).toBeInTheDocument()
  })

  it('pages with an opaque cursor and Load more', async () => {
    const user = userEvent.setup()
    let calls = 0
    server.server.use(
      http.get('/api/daily/dailies/history', ({ request }) => {
        calls += 1
        const url = new URL(request.url)
        if (url.searchParams.get('cursor') === null) {
          return HttpResponse.json({
            items: [olderOutcome('First page outcome', 1)],
            next_cursor: 'opaque-cursor-1',
          })
        }
        return HttpResponse.json({
          items: [olderOutcome('Second page outcome', 2)],
          next_cursor: null,
        })
      }),
    )
    await renderHistory()

    expect(await screen.findByRole('heading', { name: 'First page outcome' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('heading', { name: 'Second page outcome' })).toBeInTheDocument()
    expect(calls).toBe(2)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('keeps loaded groups visible and makes continuation Retry local', async () => {
    const user = userEvent.setup()
    let calls = 0
    server.server.use(
      http.get('/api/daily/dailies/history', ({ request }) => {
        calls += 1
        const url = new URL(request.url)
        if (url.searchParams.get('cursor') === null) {
          return HttpResponse.json({
            items: [olderOutcome('Stable page outcome', 3)],
            next_cursor: 'opaque-cursor-1',
          })
        }
        if (calls === 2) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'History exploded.' } },
            { status: 500 },
          )
        }
        return HttpResponse.json({
          items: [olderOutcome('Recovered page outcome', 4)],
          next_cursor: null,
        })
      }),
    )
    await renderHistory()

    expect(await screen.findByRole('heading', { name: 'Stable page outcome' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('Could not load more outcomes.')).toBeInTheDocument()
    // The loaded group stays visible and Retry is footer-local.
    expect(screen.getByRole('heading', { name: 'Stable page outcome' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry loading more history' }))
    expect(
      await screen.findByRole('heading', { name: 'Recovered page outcome' }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Could not load more outcomes.')).not.toBeInTheDocument()
  })

  it('shows an unavailable state on initial failure and recovers', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.get('/api/daily/dailies/history', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'History exploded.' } },
          { status: 500 },
        ),
      ),
    )
    await renderHistory()
    expect(
      await screen.findByRole('heading', { name: 'Daily history is unavailable' }),
    ).toBeInTheDocument()

    server.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('heading', { level: 2, name: /January 14, 2026/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('+10 materials')).toBeInTheDocument()
  })
})

function olderOutcome(title: string, index: number): Record<string, unknown> {
  return {
    id: fixedUuid(9, index),
    daily_id: '00000001-0000-4000-8000-000000000001',
    user_id: '1f8fad5b-d9cb-469f-a165-70867728950e',
    title,
    description: '',
    difficulty: 'MEDIUM',
    due_date: '2026-01-10T12:00:00Z',
    time_zone: 'UTC',
    due_local_date: '2026-01-10',
    due_local_time: '12:00',
    status: 'COMPLETED',
    completed_at: '2026-01-10T12:30:00Z',
    missed_at: null,
    archived_at: '2026-01-10T12:30:00Z',
  }
}
