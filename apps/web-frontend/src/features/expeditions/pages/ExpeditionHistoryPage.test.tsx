process.env.TZ = 'UTC'

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FIXED_EXPEDITION_IDS,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  createMockTestServer,
  createResolvedExpedition,
  fixedUuid,
  onUnhandledMockRequest,
} from '@/mocks'
import { renderAppAt } from '@/test/renderApp'
import { advanceFakeTime, seedAuthenticatedSession } from '@/test/expeditionTestUtils'

import type { MockTestServer } from '@/mocks'
import type { Expedition } from '@/api/generated/expedition/types.gen'

let server: MockTestServer
let scheduler: ManualMockScheduler

beforeEach(async () => {
  scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
  server = createMockTestServer({ scenario: 'resolved-expedition', scheduler })
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  window.localStorage.clear()
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
  await seedAuthenticatedSession()
})

afterEach(() => {
  vi.useRealTimers()
  server.server.resetHandlers()
  server.server.close()
})

function enableProbeTimers(): void {
  vi.useFakeTimers({ now: new Date(FIXED_MOCK_EPOCH_MS) })
}

async function renderHistory(): Promise<void> {
  renderAppAt('/expeditions/history')
  await screen.findByRole('heading', { level: 1, name: 'Expedition history' })
}

function buildHistory(count: number): Expedition[] {
  return Array.from({ length: count }, (_, index) =>
    createResolvedExpedition(fixedUuid(9, index + 1), {
      materials_invested: 20 + index,
      success_chance: Math.min(0.95, (index + 1) / 10),
      outcome: index % 2 === 0 ? 'SUCCESS' : 'FAILURE',
      status: index % 2 === 0 ? 'RESOLVED' : 'FAILED',
    }),
  )
}

describe('Expedition history', () => {
  it('lists resolved outcomes with typed rewards and detail links', async () => {
    await renderHistory()

    await screen.findByText('+80 materials')
    expect(screen.getByText('Success')).toBeInTheDocument()
    // Both resolved fixtures invested 40 materials.
    expect(screen.getAllByText('40 materials')).toHaveLength(2)
    expect(screen.getByText('0 materials')).toBeInTheDocument()
    // Both resolved fixtures share a 62% success chance.
    expect(screen.getAllByText('62% chance')).toHaveLength(2)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Success/ })).toHaveAttribute(
      'href',
      `/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`,
    )
    expect(screen.getByRole('link', { name: /Failed/ })).toHaveAttribute(
      'href',
      `/expeditions/${FIXED_EXPEDITION_IDS.resolvedFailure}`,
    )
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('offers launching when history is empty', async () => {
    server.reset('expedition-ready')
    await seedAuthenticatedSession()
    await renderHistory()

    await screen.findByText('No Expeditions yet')
    expect(screen.getByRole('link', { name: 'Launch an Expedition' })).toHaveAttribute(
      'href',
      '/expeditions',
    )
  })

  it('loads more pages with explicit offset and preserves loaded rows', async () => {
    const history = buildHistory(12)
    server.server.use(
      http.get('/api/expedition/expeditions', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 10)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        return HttpResponse.json(history.slice(offset, offset + limit))
      }),
    )
    await renderHistory()

    await screen.findAllByRole('link', { name: /Success|Failed/ })
    expect(screen.getAllByRole('link', { name: /Success|Failed/ })).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /Success|Failed/ })).toHaveLength(12)
    })
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('keeps loaded rows and offers a local Retry when a continuation fails', async () => {
    const history = buildHistory(12)
    server.server.use(
      http.get('/api/expedition/expeditions', ({ request }) => {
        const url = new URL(request.url)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        if (offset > 0) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Boom.' } },
            { status: 500 },
          )
        }
        return HttpResponse.json(history.slice(0, 10))
      }),
    )
    await renderHistory()

    await screen.findAllByRole('link', { name: /Success|Failed/ })
    expect(screen.getAllByRole('link', { name: /Success|Failed/ })).toHaveLength(10)
    enableProbeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await advanceFakeTime(1_100)

    screen.getByText(/Could not load more Expeditions/)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Success|Failed/ })).toHaveLength(10)
  })

  it('tracks an in-flight expedition as a plain row without an outcome badge', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderHistory()

    await screen.findByText('In flight')
    // The active expedition is listed among the resolved history rows but
    // carries no outcome badge.
    const flightRow = screen.getByRole('link', { name: /In flight/ })
    expect(flightRow).toHaveAttribute('href', `/expeditions/${FIXED_EXPEDITION_IDS.active}`)
    expect(flightRow.textContent).not.toMatch(/Success|Failed/)
  })

  it('preserves loaded rows across detail navigation from the query cache', async () => {
    let listCalls = 0
    server.server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname === '/api/expedition/expeditions') {
        listCalls += 1
      }
    })
    await renderHistory()

    await screen.findAllByRole('link', { name: /Success|Failed/ })
    expect(listCalls).toBe(1)
    fireEvent.click(screen.getAllByRole('link', { name: /Success/ })[0] as HTMLElement)
    await screen.findByText('Expedition resolved')
    expect(listCalls).toBe(1)

    fireEvent.click(screen.getByRole('link', { name: 'History' }))
    await screen.findByRole('heading', { level: 1, name: 'Expedition history' })
    // Rows come straight from the stable query key's cache — no re-request.
    expect(screen.getAllByRole('link', { name: /Success|Failed/ })).toHaveLength(2)
    expect(listCalls).toBe(1)
  })
})
