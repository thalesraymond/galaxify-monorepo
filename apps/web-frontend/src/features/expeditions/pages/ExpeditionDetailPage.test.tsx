process.env.TZ = 'UTC'

import { fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FIXED_EXPEDITION_IDS,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  createActiveExpedition,
  createMockTestServer,
  fixedUuid,
  onUnhandledMockRequest,
} from '@/mocks'
import { renderAppAt } from '@/test/renderApp'
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'

import type { MockTestServer } from '@/mocks'
import type { Expedition } from '@/api/generated/expedition/types.gen'

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

async function renderDetail(id: string): Promise<void> {
  renderAppAt(`/expeditions/${id}`)
  await screen.findByRole('heading', { level: 1, name: 'Expedition detail' })
}

/**
 * Fake-timer variant (see renderExpeditionRoute.tsx): journeys whose timers
 * (the resolve-derived poll, the result-lag probe schedule) are scheduled at
 * mount need fake timers from the very first render.
 */
async function renderDetailFake(id: string): Promise<void> {
  enableProbeTimers()
  renderExpeditionRoute(`/expeditions/${id}`)
  await advanceUntil(
    () => screen.queryByRole('heading', { level: 1, name: 'Expedition detail' }) !== null,
    'the detail page heading',
  )
}

describe('Expedition detail', () => {
  it('shows a resolved result and timeline without replaying a celebration', async () => {
    await renderDetail(RESOLVED_ID)

    await screen.findByText('Expedition resolved')
    const panel = screen.getByRole('region', { name: 'Expedition resolved' })
    expect(panel).toBeInTheDocument()
    expect(panel.className).not.toMatch(/celebrate/)
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('+80 materials')).toBeInTheDocument()
    expect(screen.getByText('Launched')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
  })

  it('recovers a not-found Expedition inside the shell with a link back', async () => {
    await renderDetail('00000000-0000-4000-8000-000000000099')

    await screen.findByRole('heading', { name: 'Expedition not found' }, { timeout: 3_000 })
    expect(screen.getByRole('link', { name: 'Back to Expeditions' })).toHaveAttribute(
      'href',
      '/expeditions',
    )
  })

  it('recovers an inaccessible or malformed id without a server call', async () => {
    await renderDetail('not-a-uuid')

    await screen.findByRole('heading', { name: 'Expedition not found' })
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

    await screen.findByText('Preparing your Expedition', {}, { timeout: 3_000 })
    expect(screen.getByText('Preparing…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows an in-flight countdown and facts, then a newly observed result', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderDetailFake(ACTIVE_ID)

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    expect(screen.getByText('Time remaining:')).toBeInTheDocument()
    expect(screen.getByText('1h 00m 00s')).toBeInTheDocument()
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
    const panel = screen.getByRole('region', { name: 'Expedition resolved' })
    expect(panel.className).toMatch(/celebrate/)
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('+80 materials')).toBeInTheDocument()

    await advanceFakeTime(500)
    expect(screen.getByRole('region', { name: 'Expedition resolved' }).className).not.toMatch(
      /celebrate/,
    )
  })

  it('shows the Failed outcome with its typed recovery reward for a low-chance Expedition', async () => {
    const id = fixedUuid(10, 2)
    const inFlight = createActiveExpedition({ id, success_chance: 0.25 })
    const resolvedAt = new Date(FIXED_MOCK_EPOCH_MS + HOUR).toISOString()
    const failed: Expedition = {
      ...inFlight,
      status: 'FAILED',
      resolved_at: resolvedAt,
      result: {
        id: fixedUuid(10, 3),
        expedition_id: id,
        outcome: 'FAILURE',
        material_reward: { materials: 20 },
        created_at: resolvedAt,
      },
    }
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () =>
        HttpResponse.json(scheduler.now() < FIXED_MOCK_EPOCH_MS + HOUR ? inFlight : failed),
      ),
    )
    await renderDetailFake(id)

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    scheduler.advance(HOUR)
    await advanceFakeTime(60_050)

    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the failed result',
      50,
      30,
    )
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('+20 materials')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Expedition resolved' }).className).toMatch(
      /celebrate/,
    )
  })

  it('reconciles a lagging typed result before showing it', async () => {
    const id = fixedUuid(10, 4)
    let detailCalls = 0
    const resolvedAt = new Date(FIXED_MOCK_EPOCH_MS - 60 * 60 * 1000).toISOString()
    const withoutResult: Expedition = {
      id,
      user_id: '1f8fad5b-d9cb-469f-a165-70867728950e',
      materials_invested: 40,
      success_chance: 0.62,
      resolve_at: resolvedAt,
      status: 'RESOLVED',
      created_at: new Date(FIXED_MOCK_EPOCH_MS - 2 * 60 * 60 * 1000).toISOString(),
      resolved_at: resolvedAt,
    }
    const withResult: Expedition = {
      ...withoutResult,
      result: {
        id: fixedUuid(10, 5),
        expedition_id: id,
        outcome: 'SUCCESS',
        material_reward: { materials: 80 },
        created_at: resolvedAt,
      },
    }
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => {
        detailCalls += 1
        return HttpResponse.json(detailCalls <= 2 ? withoutResult : withResult)
      }),
    )
    await renderDetailFake(id)

    // The status transitioned but the typed result has not landed yet: bounded
    // reconciliation shows Updating… until the detail carries the result.
    await advanceUntil(
      () => screen.queryByText('Confirming your result') !== null,
      'the pending result',
    )
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    await advanceFakeTime(1_100)
    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the reconciled result',
    )
    expect(detailCalls).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('+80 materials')).toBeInTheDocument()
  })

  it('expires a never-arriving result into Update delayed with a local Retry', async () => {
    const id = fixedUuid(10, 6)
    const resolvedAt = new Date(FIXED_MOCK_EPOCH_MS - 60 * 60 * 1000).toISOString()
    const withoutResult: Expedition = {
      id,
      user_id: '1f8fad5b-d9cb-469f-a165-70867728950e',
      materials_invested: 40,
      success_chance: 0.62,
      resolve_at: resolvedAt,
      status: 'RESOLVED',
      created_at: new Date(FIXED_MOCK_EPOCH_MS - 2 * 60 * 60 * 1000).toISOString(),
      resolved_at: resolvedAt,
    }
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => HttpResponse.json(withoutResult)),
    )
    await renderDetailFake(id)

    await advanceUntil(
      () => screen.queryByText('Confirming your result') !== null,
      'the pending result',
    )
    await advanceFakeTime(8_500)

    expect(screen.getByText('Update delayed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('keeps stale in-flight data labelled Update delayed with a Retry when a refetch fails', async () => {
    server.reset('active-expedition')
    await seedAuthenticatedSession()
    await renderDetailFake(ACTIVE_ID)

    await advanceUntil(
      () => screen.queryByText('Expedition in flight') !== null,
      'the in-flight view',
    )
    server.server.use(
      http.get(`/api/expedition/expeditions/${ACTIVE_ID}`, () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Boom.' } }, { status: 500 }),
      ),
    )
    await advanceFakeTime(60_050)
    await advanceUntil(
      () => screen.queryByText('Update delayed') !== null,
      'the stale label',
      50,
      80,
    )
    expect(screen.getByText('Expedition in flight')).toBeInTheDocument()

    server.server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () => screen.queryByText('Update delayed') === null,
      'the refresh to recover',
    )
    expect(screen.getByText('Expedition in flight')).toBeInTheDocument()
  })
})
