process.env.TZ = 'UTC'

import { act, fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FIXED_EXPEDITION_IDS,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  createActiveExpedition,
  createMockTestServer,
  createResolvedExpedition,
  fixedUuid,
  onUnhandledMockRequest,
} from '@/mocks'
import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import { createQueryClient } from '@/app/queryClient'
import { downstreamReconciliation, getBalanceGateKeys } from '@/shared/reconciliation'
import { expeditionDetailQueryKeyFor } from '../api/expeditionApi'
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
  setVisibility(true)
  server.server.resetHandlers()
  server.server.close()
})

function setVisibility(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  })
}

function enableReconciliationTimers(): void {
  vi.useFakeTimers({ now: new Date(FIXED_MOCK_EPOCH_MS) })
}

async function renderDetail(id: string): Promise<void> {
  renderAppAt(`/expeditions/${id}`)
  await screen.findByRole('heading', { level: 1, name: 'Expedition detail' })
}

/**
 * Fake-timer variant (see renderExpeditionRoute.tsx): journeys whose timers
 * (the resolve-derived poll, the result-lag reconciliation schedule) are scheduled at
 * mount need fake timers from the very first render.
 */
async function renderDetailFake(id: string): Promise<void> {
  enableReconciliationTimers()
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

/**
 * The fixture's resolved Expedition with its typed result stripped, matching a
 * status transition whose result has not propagated yet.
 */
function expeditionWithoutResult(id: string): Expedition {
  const resolved = createResolvedExpedition(id)
  return {
    id: resolved.id,
    user_id: resolved.user_id,
    materials_invested: resolved.materials_invested,
    success_chance: resolved.success_chance,
    resolve_at: resolved.resolve_at,
    status: resolved.status,
    created_at: resolved.created_at,
    resolved_at: resolved.resolved_at ?? resolved.created_at,
  }
}

/**
 * The shared Downstream Reconciliation lifecycle exercised through the real
 * caller: `/expeditions/:id` observes a resolved-but-untyped result, publishes
 * fresh facts into the shared detail query, and survives navigation, pauses,
 * slow/error reads, expiry/retry, and session clearing.
 */
describe('Expedition detail — result observation lifecycle', () => {
  const id = RESOLVED_ID

  it('discards a detail response held across logout', async () => {
    let requested = false
    let release: () => void = () => {}
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, async () => {
        requested = true
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return HttpResponse.json(createResolvedExpedition(id))
      }),
    )
    enableReconciliationTimers()
    const client = createQueryClient()
    renderExpeditionRoute(`/expeditions/${id}`, client)
    await advanceUntil(() => requested, 'the detail request')
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await advanceUntil(
      () => window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY) === null,
      'logout',
    )
    await act(async () => {
      release()
      await Promise.resolve()
    })
    await advanceFakeTime(100)
    expect(client.getQueryData(expeditionDetailQueryKeyFor(id))).toBeUndefined()
    expect(downstreamReconciliation.getPhase(`expedition:${id}:reward`)).toBe('idle')
    expect(downstreamReconciliation.getPhase(`expedition:${id}:result`)).toBe('idle')
    expect(getBalanceGateKeys()).toHaveLength(0)
  })

  it('survives navigation and resumes the remaining budget with no reads while away', async () => {
    let resultAvailable = false
    let detailCalls = 0
    const withoutResult = expeditionWithoutResult(id)
    const withResult = createResolvedExpedition(id)
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => {
        detailCalls += 1
        return HttpResponse.json(resultAvailable ? withResult : withoutResult)
      }),
    )
    await renderDetailFake(id)

    await advanceUntil(
      () => screen.queryByText('Confirming your result') !== null,
      'the pending result',
    )
    // The mount read plus the immediate observation read.
    expect(detailCalls).toBe(2)

    // Burn part of the budget: the ≈1s mark read.
    await advanceFakeTime(1_100)
    expect(detailCalls).toBe(3)

    // Route away: no visible observer of the affected resource, so reads pause
    // without consuming the remaining budget.
    fireEvent.click(screen.getByRole('link', { name: 'History' }))
    await advanceUntil(
      () => screen.queryByRole('heading', { level: 1, name: 'Expedition history' }) !== null,
      'the history page',
    )
    await advanceFakeTime(20_000)
    expect(detailCalls).toBe(3)

    // Return: the pending round is still Updating with its remaining budget.
    fireEvent.click(screen.getByRole('link', { name: /Success/ }))
    await advanceUntil(
      () => screen.queryByRole('heading', { level: 1, name: 'Expedition detail' }) !== null,
      'the detail page again',
    )
    expect(screen.getByText('Confirming your result')).toBeInTheDocument()
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()

    await advanceFakeTime(500)
    expect(detailCalls).toBe(3)

    resultAvailable = true
    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the reconciled result',
    )
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText('+80 materials')).toBeInTheDocument()
    expect(detailCalls).toBe(4)
  })

  it('does not start reads while already hidden and starts once visible', async () => {
    let resultAvailable = false
    let detailCalls = 0
    const withoutResult = expeditionWithoutResult(id)
    const withResult = createResolvedExpedition(id)
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => {
        detailCalls += 1
        return HttpResponse.json(resultAvailable ? withResult : withoutResult)
      }),
    )
    setVisibility(false)
    await renderDetailFake(id)

    await advanceUntil(
      () => screen.queryByText('Confirming your result') !== null,
      'the pending result',
    )
    // Only the mount read: the bounded schedule must not start while paused.
    expect(detailCalls).toBe(1)
    await advanceFakeTime(10_000)
    expect(detailCalls).toBe(1)
    expect(screen.getByText('Updating…')).toBeInTheDocument()

    setVisibility(true)
    resultAvailable = true
    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the result after becoming visible',
    )
    expect(detailCalls).toBe(2)
  })

  it('preserves a delayed result and its Retry identity across navigation', async () => {
    let available = false
    let detailCalls = 0
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => {
        detailCalls += 1
        return HttpResponse.json(
          available ? createResolvedExpedition(id) : expeditionWithoutResult(id),
        )
      }),
    )
    await renderDetailFake(id)
    await advanceUntil(
      () => screen.queryByText('Confirming your result') !== null,
      'the pending result',
    )
    await advanceFakeTime(8_500)
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
    expect(detailCalls).toBe(6)

    fireEvent.click(screen.getByRole('link', { name: 'History' }))
    await advanceUntil(
      () => screen.queryByRole('heading', { name: 'Expedition history' }) !== null,
      'history',
    )
    await advanceFakeTime(20_000)
    fireEvent.click(screen.getByRole('link', { name: /Success/ }))
    await advanceUntil(() => screen.queryByText('Update delayed') !== null, 'the delayed result')
    expect(detailCalls).toBe(6)

    available = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () => screen.queryByText('+80 materials') !== null,
      'the expected result after Retry',
    )
    expect(detailCalls).toBe(7)
    expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
  })

  it('bounds hanging reads, expires into Update delayed, and restarts on Retry', async () => {
    let resultAvailable = false
    let detailCalls = 0
    const withoutResult = expeditionWithoutResult(id)
    const withResult = createResolvedExpedition(id)
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => {
        detailCalls += 1
        if (detailCalls === 1) {
          return HttpResponse.json(withoutResult)
        }
        if (resultAvailable) {
          return HttpResponse.json(withResult)
        }
        return new Promise<never>(() => {})
      }),
    )
    await renderDetailFake(id)

    await advanceUntil(
      () => screen.queryByText('Confirming your result') !== null,
      'the pending result',
    )
    expect(detailCalls).toBe(2)

    // The immediate read hangs: timeout ends this round instead of starting
    // another automatic read alongside a request that may ignore cancellation.
    await advanceFakeTime(5_500)
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
    expect(detailCalls).toBe(2)

    resultAvailable = true
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the retried result',
    )
    expect(screen.getByText('+80 materials')).toBeInTheDocument()
    expect(detailCalls).toBe(3)
  })

  it('does not replace a confirmed result with an older missing-result observation', async () => {
    let calls = 0
    let resolveRefresh: (response: Response) => void = () => {}
    let resolveObservation: (response: Response) => void = () => {}
    const missing = expeditionWithoutResult(id)
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => {
        calls += 1
        if (calls === 7) {
          return new Promise<Response>((resolve) => {
            resolveRefresh = resolve
          })
        }
        if (calls === 8) {
          return new Promise<Response>((resolve) => {
            resolveObservation = resolve
          })
        }
        return HttpResponse.json(missing)
      }),
    )
    await renderDetailFake(id)
    await advanceFakeTime(8_500)
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'History' }))
    await advanceUntil(
      () => screen.queryByRole('heading', { name: 'Expedition history' }) !== null,
      'history',
    )
    await advanceFakeTime(31_000)
    fireEvent.click(screen.getByRole('link', { name: /Success/ }))
    await advanceUntil(() => calls === 7, 'the stale detail refresh')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await advanceUntil(() => calls === 8, 'the retried observation')
    act(() => {
      resolveRefresh(HttpResponse.json(createResolvedExpedition(id)))
    })
    await advanceUntil(() => screen.queryByText('+80 materials') !== null, 'the confirmed result')
    act(() => {
      resolveObservation(HttpResponse.json(missing))
    })
    await advanceFakeTime(100)
    expect(screen.getByText('+80 materials')).toBeInTheDocument()
    expect(screen.queryByText('Confirming your result')).not.toBeInTheDocument()
  })

  it('keeps probing after failed fresh reads and confirms only on a fresh success', async () => {
    let detailCalls = 0
    const withoutResult = expeditionWithoutResult(id)
    const withResult = createResolvedExpedition(id)
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => {
        detailCalls += 1
        if (detailCalls === 1) {
          return HttpResponse.json(withoutResult)
        }
        if (detailCalls <= 3) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'Boom.' } },
            { status: 500 },
          )
        }
        return HttpResponse.json(withResult)
      }),
    )
    await renderDetailFake(id)

    await advanceUntil(
      () => screen.queryByText('Confirming your result') !== null,
      'the pending result',
    )
    await advanceFakeTime(1_100)
    // The immediate and ≈1s reads failed: no confirmation, still bounded.
    expect(detailCalls).toBe(3)
    expect(screen.getByText('Updating…')).toBeInTheDocument()
    expect(screen.queryByText('Expedition resolved')).not.toBeInTheDocument()

    await advanceUntil(
      () => screen.queryByText('Expedition resolved') !== null,
      'the fresh confirmation',
    )
    expect(detailCalls).toBe(4)
  })

  it('cancels pending observation on logout and never republishes protected facts', async () => {
    let detailCalls = 0
    const withoutResult = expeditionWithoutResult(id)
    server.server.use(
      http.get(`/api/expedition/expeditions/${id}`, () => {
        detailCalls += 1
        return HttpResponse.json(withoutResult)
      }),
    )
    await renderDetailFake(id)

    await advanceUntil(
      () => screen.queryByText('Confirming your result') !== null,
      'the pending result',
    )
    expect(detailCalls).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    await advanceUntil(
      () => window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY) === null,
      'the logout to clear the session',
    )

    expect(screen.queryByText('Confirming your result')).not.toBeInTheDocument()
    await advanceFakeTime(60_000)
    expect(detailCalls).toBe(2)
  })
})
