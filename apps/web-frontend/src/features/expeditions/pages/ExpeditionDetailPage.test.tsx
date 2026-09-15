process.env.TZ = 'UTC'

import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FIXED_EXPEDITION_IDS,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  createMockTestServer,
  onUnhandledMockRequest,
} from '@/mocks'
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'

import type { MockTestServer } from '@/mocks'

const HOUR = 60 * 60 * 1000
const ACTIVE_ID = FIXED_EXPEDITION_IDS.active
const RESOLVED_ID = FIXED_EXPEDITION_IDS.resolvedSuccess

let server: MockTestServer
let scheduler: ManualMockScheduler

beforeEach(async () => {
  scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
  server = createMockTestServer({ scenario: 'resolved-expedition', scheduler })
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  window.localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_MOCK_EPOCH_MS)
  await seedAuthenticatedSession()
})

afterEach(() => {
  vi.useRealTimers()
  server.server.resetHandlers()
  server.server.close()
})

async function renderDetail(id: string) {
  renderExpeditionRoute(`/expeditions/${id}`)
  await advanceUntil(
    () => screen.queryByRole('heading', { level: 1, name: 'Expedition detail' }) !== null,
    'the detail page heading',
  )
}

describe('Expedition detail', () => {
  it('shows a resolved result and timeline without replaying a celebration', async () => {
    await renderDetail(RESOLVED_ID)

    await advanceUntil(() => screen.queryByText('Expedition resolved') !== null, 'the result')
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('+80 materials')).toBeInTheDocument()
    expect(screen.getByText('Launched')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Expedition resolved' }).getAttribute('data-celebrate'),
    ).not.toBe('true')
  })

  it('recovers a not-found Expedition inside the shell with a link back', async () => {
    await renderDetail('00000000-0000-4000-8000-000000000099')

    await advanceUntil(
      () => screen.queryByRole('heading', { name: 'Expedition not found' }) !== null,
      'the not-found state',
    )
    expect(screen.getByRole('link', { name: 'Back to Expeditions' })).toHaveAttribute(
      'href',
      '/expeditions',
    )
  })

  it('recovers an inaccessible or malformed id without a server call', async () => {
    await renderDetail('not-a-uuid')

    await advanceUntil(
      () => screen.queryByRole('heading', { name: 'Expedition not found' }) !== null,
      'the not-found state',
    )
    expect(screen.getByRole('heading', { name: 'Expedition not found' })).toBeInTheDocument()
  })

  it('shows Preparing… with Retry for a provisioning detail request', async () => {
    server.server.use(
      http.get(`/api/expedition/expeditions/${ACTIVE_ID}`, () =>
        HttpResponse.json(
          { error: { code: 'EXPEDITION_SHIP_STATE_NOT_READY', message: 'Not ready yet.' } },
          { status: 503 },
        ),
      ),
    )
    await renderDetail(ACTIVE_ID)

    await advanceUntil(
      () => screen.queryByText('Preparing your Expedition') !== null,
      'the preparing state',
    )
    expect(screen.getByText('Preparing…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows an in-flight countdown and facts, then a newly observed result', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderDetail(ACTIVE_ID)

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByLabelText('Time remaining')).toHaveTextContent(
      /^Resolves in(\d+h )?\d{2}m \d{2}s$/,
    )
    expect(screen.getByText(/Resolves at 10:00 AM/)).toBeInTheDocument()
    expect(screen.getByText('40 materials')).toBeInTheDocument()
    expect(screen.getByText('62%')).toBeInTheDocument()

    scheduler.advance(HOUR)
    await advanceFakeTime(60_050)

    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the resolved result',
      50,
      30,
    )
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('+80 materials')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Expedition resolved' })).toHaveAttribute(
      'data-celebrate',
      'true',
    )

    await advanceFakeTime(500)
    expect(
      screen.getByRole('region', { name: 'Expedition resolved' }).getAttribute('data-celebrate'),
    ).not.toBe('true')
  })
})
