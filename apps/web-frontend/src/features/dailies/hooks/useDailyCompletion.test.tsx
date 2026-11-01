import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Difficulty } from '@/api/generated/daily/types.gen'
import { ApiTransport } from '@/api/transport'
import { shipQueryKey, type ShipState } from '@/features/ship'
import { createDaily, createHealthyShip, FIXED_DAILY_IDS } from '@/mocks/fixtures'
import { clearDownstreamObservations, useDownstreamObservation } from '@/shared/reconciliation'

import { dailyAwardObservationKey } from '../lib/dailyAwardObservation'
import type { DifficultyRewards } from '../lib/difficulties'
import { useDailyCompletion } from './useDailyCompletion'

const DAILY_ID = FIXED_DAILY_IDS.calibrate
const OTHER_DAILY_ID = FIXED_DAILY_IDS.stretch

const DIFFICULTIES: ReadonlyMap<Difficulty, DifficultyRewards> = new Map([
  ['EASY', { reward: 10, damage: 5 }],
  ['HARD', { reward: 50, damage: 30 }],
])

/** One scripted Ship read: a confirmed balance, or a failed read. */
type ShipStep = { readonly balance: number } | { readonly failure: true }

type FakeBackend = {
  readonly transport: ApiTransport
  /** Replaces the scripted Ship reads; the last one answers every later read. */
  readonly setSteps: (...steps: ShipStep[]) => void
  readonly shipCalls: number
}

/** A transport that answers the Daily completion and scripts the Ship reads. */
function createFakeBackend(awardFor: (dailyId: string) => number): FakeBackend {
  const state: { steps: ShipStep[]; shipCalls: number } = {
    steps: [],
    shipCalls: 0,
  }
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/ships/me')) {
      const step = state.steps[Math.min(state.shipCalls, state.steps.length - 1)]
      state.shipCalls += 1
      if (step === undefined || 'failure' in step) {
        return Promise.resolve(
          jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Ship unavailable' } }, 500),
        )
      }
      return Promise.resolve(jsonResponse(createHealthyShip({ materials_balance: step.balance })))
    }
    const dailyId = /\/api\/daily\/dailies\/([^/]+)\/complete/.exec(url)?.[1] ?? ''
    return Promise.resolve(
      jsonResponse({
        ...createDaily(dailyId, { status: 'COMPLETED' }),
        awarded_materials: awardFor(dailyId),
      }),
    )
  })
  return {
    transport: new ApiTransport({ fetch }),
    setSteps: (...steps: ShipStep[]) => {
      state.steps = steps
    },
    get shipCalls() {
      return state.shipCalls
    },
  }
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

/** Flushes promise work and React updates without advancing the schedule. */
async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

/** Advances the bounded observation schedule by one gap. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Advances through every read mark of the bounded schedule (0/1/2/4/8s). */
async function advanceSchedule(): Promise<void> {
  for (const gap of [1_000, 1_000, 2_000, 4_000]) {
    await advance(gap)
    await settle()
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type CompletionView = {
  readonly current: ReturnType<typeof useDailyCompletion> | undefined
  readonly unmount: () => void
}

type MountOptions = {
  /**
   * Whether the harness plays the visible observer of the completed row. A
   * view that displays the reconciled resource observes it; a view that does
   * not leaves the bounded round paused.
   */
  readonly observes?: boolean
}

/** Renders the completion hook against a real QueryClient. */
function mountCompletion(
  transport: ApiTransport,
  queryClient: QueryClient,
  options: MountOptions = {},
): CompletionView {
  const view: { current: ReturnType<typeof useDailyCompletion> | undefined } = {
    current: undefined,
  }
  function Harness() {
    view.current = useDailyCompletion(transport, {}, DIFFICULTIES)
    // The completed row is the visible observer of the affected Ship balance
    // (spec §3.2); the harness plays that role, so the bounded schedule only
    // runs while a view displays the reconciled resource.
    const observes = options.observes ?? true
    useDownstreamObservation(
      dailyAwardObservationKey(DAILY_ID),
      observes && view.current.reconciliations.get(DAILY_ID) !== undefined,
    )
    useDownstreamObservation(
      dailyAwardObservationKey(OTHER_DAILY_ID),
      observes && view.current.reconciliations.get(OTHER_DAILY_ID) !== undefined,
    )
    return null
  }
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  )
  return {
    get current() {
      return view.current
    },
    unmount,
  }
}

/**
 * Completes a Daily. The command, its answer, and the first fresh read settle
 * inside one act scope, so React never renders outside it.
 */
async function complete(
  view: CompletionView,
  dailyId: string,
  difficulty: Difficulty = 'EASY',
): Promise<void> {
  await act(async () => {
    view.current?.complete(dailyId, difficulty)
    await Promise.resolve()
  })
  await settle()
}

/** Confirms a Ship balance the browser already holds (the pre-command baseline). */
function confirmShipBalance(queryClient: QueryClient, balance: number): void {
  queryClient.setQueryData(shipQueryKey, {
    kind: 'ready',
    ship: createHealthyShip({ materials_balance: balance }),
  } satisfies ShipState)
}

beforeEach(() => {
  vi.useFakeTimers()
  clearDownstreamObservations()
})

afterEach(() => {
  clearDownstreamObservations()
  vi.useRealTimers()
})

describe('Daily completion reconciliation', () => {
  it('settles as ready when the first fresh read already shows the award', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ balance: 260 })
    const view = mountCompletion(backend.transport, queryClient)

    await complete(view, DAILY_ID)

    expect(view.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'ready',
      baseline: 250,
      observed: 260,
      expectedAward: 10,
    })
    // The fresh facts are visible in the shared Ship query.
    expect(queryClient.getQueryData(shipQueryKey)).toEqual({
      kind: 'ready',
      ship: createHealthyShip({ materials_balance: 260 }),
    })
  })

  it('keeps probing until a later fresh read shows the award', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ balance: 250 }, { balance: 260 })
    const view = mountCompletion(backend.transport, queryClient)

    await complete(view, DAILY_ID)

    expect(view.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'probing',
      baseline: 250,
      observed: 250,
      expectedAward: 10,
    })

    await advance(1_000)
    await settle()

    expect(view.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'ready',
      baseline: 250,
      observed: 260,
      expectedAward: 10,
    })
  })

  it('reconciles two completed Dailies independently', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend((dailyId) => (dailyId === DAILY_ID ? 50 : 10))
    backend.setSteps({ balance: 250 }, { balance: 250 }, { balance: 260 })
    const view = mountCompletion(backend.transport, queryClient)

    await act(async () => {
      view.current?.complete(DAILY_ID, 'HARD')
      view.current?.complete(OTHER_DAILY_ID, 'EASY')
      await Promise.resolve()
    })
    await settle()

    // Both outcomes are independent: neither settles on the other's award.
    expect(view.current?.reconciliations.get(DAILY_ID)?.phase).toBe('probing')
    expect(view.current?.reconciliations.get(OTHER_DAILY_ID)?.phase).toBe('probing')

    await advance(1_000)
    await settle()

    // The smaller award is satisfied by the observed balance; the larger one
    // keeps probing on its own schedule.
    expect(view.current?.reconciliations.get(OTHER_DAILY_ID)?.phase).toBe('ready')
    expect(view.current?.reconciliations.get(DAILY_ID)?.phase).toBe('probing')

    backend.setSteps({ balance: 300 })
    await advance(1_000)
    await settle()

    expect(view.current?.reconciliations.get(DAILY_ID)?.phase).toBe('ready')
    expect(view.current?.reconciliations.get(DAILY_ID)?.observed).toBe(300)
  })

  it('waits for the expected award when spending moves the balance the other way', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ balance: 250 }, { balance: 230 }, { balance: 260 })
    const view = mountCompletion(backend.transport, queryClient)

    await complete(view, DAILY_ID)

    // The spending dropped the balance below the baseline: no evidence yet.
    await advance(1_000)
    await settle()
    expect(view.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'probing',
      baseline: 250,
      observed: 230,
      expectedAward: 10,
    })

    await advance(1_000)
    await settle()
    expect(view.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'ready',
      baseline: 250,
      observed: 260,
      expectedAward: 10,
    })
  })

  it('publishes facts without a baseline but never claims the award', async () => {
    const queryClient = createQueryClient()
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ balance: 260 })
    const view = mountCompletion(backend.transport, queryClient)

    await complete(view, DAILY_ID)

    // Without a pre-command baseline the facts are published, but they are
    // not evidence that this Daily's award was applied.
    expect(view.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'probing',
      baseline: undefined,
      observed: 260,
      expectedAward: 10,
    })
    expect(queryClient.getQueryData(shipQueryKey)).toEqual({
      kind: 'ready',
      ship: createHealthyShip({ materials_balance: 260 }),
    })

    await advanceSchedule()

    expect(view.current?.reconciliations.get(DAILY_ID)?.phase).toBe('delayed')
  })

  it('keeps the confirmed Ship balance when a fresh read fails', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ failure: true }, { balance: 260 })
    const view = mountCompletion(backend.transport, queryClient)

    await complete(view, DAILY_ID)

    // The failed read published nothing: the confirmed balance is untouched
    // and the observation keeps its budget.
    expect(queryClient.getQueryData(shipQueryKey)).toEqual({
      kind: 'ready',
      ship: createHealthyShip({ materials_balance: 250 }),
    })
    expect(view.current?.reconciliations.get(DAILY_ID)?.phase).toBe('probing')

    await advance(1_000)
    await settle()

    expect(view.current?.reconciliations.get(DAILY_ID)?.phase).toBe('ready')
    expect(view.current?.reconciliations.get(DAILY_ID)?.observed).toBe(260)
  })

  it('restarts only the observation budget when the player retries', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ balance: 250 })
    const view = mountCompletion(backend.transport, queryClient)

    await complete(view, DAILY_ID)

    await advanceSchedule()
    expect(view.current?.reconciliations.get(DAILY_ID)?.phase).toBe('delayed')

    // The award propagates after the window expired; a local Retry keeps the
    // original baseline and award expectation.
    backend.setSteps({ balance: 260 })
    await act(async () => {
      view.current?.retryReconciliation(DAILY_ID)
      await Promise.resolve()
    })
    await settle()

    expect(view.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'ready',
      baseline: 250,
      observed: 260,
      expectedAward: 10,
    })
  })

  it('survives navigation: the pending outcome resumes and settles', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ balance: 250 }, { balance: 260 })
    const first = mountCompletion(backend.transport, queryClient)

    await complete(first, DAILY_ID)
    expect(first.current?.reconciliations.get(DAILY_ID)?.phase).toBe('probing')

    first.unmount()

    // The observation belongs to the Player session, not to the view.
    const second = mountCompletion(backend.transport, queryClient)
    expect(second.current?.reconciliations.get(DAILY_ID)?.phase).toBe('probing')

    await advance(1_000)
    await settle()

    expect(second.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'ready',
      baseline: 250,
      observed: 260,
      expectedAward: 10,
    })
  })

  it('publishes the full observed Ship facts to the shared Ship query', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ balance: 275 })
    const view = mountCompletion(backend.transport, queryClient)

    await complete(view, DAILY_ID)

    expect(queryClient.getQueryData(shipQueryKey)).toEqual({
      kind: 'ready',
      ship: createHealthyShip({ materials_balance: 275 }),
    })
    expect(view.current?.reconciliations.get(DAILY_ID)?.observed).toBe(275)
  })

  it('pauses while no view displays the reconciled resource and resumes on the observer', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    const backend = createFakeBackend(() => 10)
    backend.setSteps({ balance: 260 })
    const first = mountCompletion(backend.transport, queryClient, { observes: false })

    await complete(first, DAILY_ID)

    // No view displays the completed row: the round is paused and reads
    // nothing, while the expectation still belongs to the session.
    await advance(10_000)
    await settle()
    expect(backend.shipCalls).toBe(0)
    expect(first.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'probing',
      baseline: 250,
      observed: undefined,
      expectedAward: 10,
    })

    first.unmount()

    // The row appears again: the round resumes with its remaining budget and
    // settles on the fresh facts.
    const second = mountCompletion(backend.transport, queryClient)
    await settle()

    expect(second.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'ready',
      baseline: 250,
      observed: 260,
      expectedAward: 10,
    })
  })

  it('restarts a delayed round when the same Daily is completed again', async () => {
    const queryClient = createQueryClient()
    confirmShipBalance(queryClient, 250)
    let award = 10
    const backend = createFakeBackend(() => award)
    backend.setSteps({ balance: 250 })
    const view = mountCompletion(backend.transport, queryClient)

    await complete(view, DAILY_ID)

    // The award never lands: the bounded budget expires into delayed.
    await advanceSchedule()
    expect(view.current?.reconciliations.get(DAILY_ID)?.phase).toBe('delayed')

    // The award lands later and the Player completes the same Daily again.
    confirmShipBalance(queryClient, 260)
    award = 25
    backend.setSteps({ balance: 285 })
    await complete(view, DAILY_ID)

    // The later completion starts a fresh observation with its own baseline
    // and award, and settles on it.
    expect(view.current?.reconciliations.get(DAILY_ID)).toEqual({
      phase: 'ready',
      baseline: 260,
      observed: 285,
      expectedAward: 25,
    })
  })
})
