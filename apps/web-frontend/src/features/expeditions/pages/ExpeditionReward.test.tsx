import { act, fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  FIXED_EXPEDITION_IDS,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  createMockTestServer,
  onUnhandledMockRequest,
} from '@/mocks'
import { createHealthyShip, createResolvedExpedition } from '@/mocks'
import { createQueryClient } from '@/app/queryClient'
import { shipQueryKey } from '@/features/ship'
import { clearDownstreamObservations, downstreamObservationPhase } from '@/shared/reconciliation'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'
import { enableFakeTimers } from '@/test/fakeTimers'
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'
import { expeditionRewardKey, getExpeditionRewards } from '../lib/expeditionRewardObservation'

const server = createMockTestServer({
  scenario: 'resolved-expedition',
  scheduler: new ManualMockScheduler(FIXED_MOCK_EPOCH_MS),
})

beforeEach(async () => {
  clearDownstreamObservations()
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  window.localStorage.clear()
  await seedAuthenticatedSession()
  enableFakeTimers(FIXED_MOCK_EPOCH_MS)
})

afterEach(() => {
  act(() => {
    clearDownstreamObservations()
  })
  vi.useRealTimers()
  server.server.resetHandlers()
  server.server.close()
})

it('observes a direct result without claiming confirmation when no baseline is known', async () => {
  renderExpeditionRoute(`/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`)
  await advanceUntil(() => screen.queryByText('+80 materials') !== null, 'typed result')
  await advanceUntil(() => screen.queryByText('Updating…') !== null, 'reward observation')
  expect(screen.getByText(/Available materials:/)).toBeInTheDocument()
  await advanceFakeTime(10_000)
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
})

it('compares a fast reward to the confirmed pre-resolution balance and never repeats it on revisit', async () => {
  const client = createQueryClient()
  let reads = 0
  server.server.use(
    http.get(`/api/expedition/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`, () => {
      client.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
      })
      return HttpResponse.json(createResolvedExpedition(FIXED_EXPEDITION_IDS.resolvedSuccess))
    }),
    http.get('/api/ship/ships/me', () => {
      reads += 1
      return HttpResponse.json(createHealthyShip({ materials_balance: 330 }))
    }),
  )
  renderExpeditionRoute(`/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`, client)
  await advanceUntil(
    () =>
      screen.queryByText('Available materials: 330') !== null &&
      screen.queryByText('Updating…') === null,
    'fast reward',
  )
  expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  expect(reads).toBe(1)
  fireEvent.click(screen.getByRole('link', { name: 'History' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Expedition history' }) !== null,
    'history',
  )
  fireEvent.click(screen.getByRole('link', { name: /Success/ }))
  await advanceUntil(() => screen.queryByText('+80 materials') !== null, 'result again')
  await advanceFakeTime(1_000)
  expect(reads).toBe(1)
})

it('retries a delayed observation using the original baseline', async () => {
  const client = createQueryClient()
  let balance = 250
  server.server.use(
    http.get(`/api/expedition/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`, () => {
      client.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
      })
      return HttpResponse.json(createResolvedExpedition(FIXED_EXPEDITION_IDS.resolvedSuccess))
    }),
    http.get('/api/ship/ships/me', () =>
      HttpResponse.json(createHealthyShip({ materials_balance: balance })),
    ),
  )
  renderExpeditionRoute(`/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`, client)
  await advanceUntil(() => screen.queryByText('Updating…') !== null, 'reward observation')
  await advanceFakeTime(10_000)
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
  balance = 330
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await advanceUntil(
    () =>
      screen.queryByText('Available materials: 330') !== null &&
      screen.queryByText('Updating…') === null,
    'retried reward',
  )
  expect(screen.queryByText('Update delayed')).not.toBeInTheDocument()
})

it('continues the same pending round across detail, overview and detail navigation', async () => {
  const client = createQueryClient()
  let reads = 0
  server.server.use(
    http.get('/api/ship/ships/me', () => {
      reads += 1
      return HttpResponse.json(createHealthyShip({ materials_balance: 250 }))
    }),
  )
  renderExpeditionRoute(`/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`, client)
  await advanceUntil(() => screen.queryByText('Updating…') !== null, 'pending reward')
  await advanceFakeTime(3_000)
  fireEvent.click(screen.getByRole('link', { name: 'Overview' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Expeditions' }) !== null,
    'overview',
  )
  expect(screen.getByText('Updating…')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'History' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Expedition history' }) !== null,
    'history',
  )
  const pausedReads = reads
  await advanceFakeTime(15_000)
  expect(reads).toBe(pausedReads)
  fireEvent.click(screen.getByRole('link', { name: /Success/ }))
  await advanceUntil(() => screen.queryByText('Updating…') !== null, 'resumed reward')
  await advanceFakeTime(6_000)
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: 'Overview' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Expeditions' }) !== null,
    'overview again',
  )
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
})

it('observes a typed current result on Dashboard without fetching detail', async () => {
  const client = createQueryClient()
  let detailReads = 0
  server.server.use(
    http.get('/api/expedition/expeditions/current', () => {
      client.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
      })
      return HttpResponse.json(createResolvedExpedition(FIXED_EXPEDITION_IDS.resolvedSuccess))
    }),
    http.get(`/api/expedition/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`, () => {
      detailReads += 1
      return HttpResponse.json(createResolvedExpedition(FIXED_EXPEDITION_IDS.resolvedSuccess))
    }),
    http.get('/api/ship/ships/me', () =>
      HttpResponse.json(
        createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
      ),
    ),
  )
  renderExpeditionRoute('/dashboard', client)
  await advanceUntil(() => screen.queryByText('Expedition resolved') !== null, 'resolved current')
  await advanceUntil(() => screen.queryByText('Updating…') !== null, 'reward on Dashboard')
  expect(screen.getByText('Available materials: 250')).toBeInTheDocument()
  expect(detailReads).toBe(0)
})

it('does not fetch a missing result or register an observation from Dashboard', async () => {
  const id = FIXED_EXPEDITION_IDS.resolvedSuccess
  const expedition = createResolvedExpedition(id)
  delete expedition.result
  let detailReads = 0
  server.server.use(
    http.get('/api/expedition/expeditions/current', () => HttpResponse.json(expedition)),
    http.get(`/api/expedition/expeditions/${id}`, () => {
      detailReads += 1
      return HttpResponse.json(expedition)
    }),
  )
  renderExpeditionRoute('/dashboard')
  await advanceUntil(() => screen.queryByText('Expedition resolved') !== null, 'resolved current')
  await advanceFakeTime(2_000)
  expect(detailReads).toBe(0)
  expect(getExpeditionRewards().size).toBe(0)
})

it('handles a zero failure reward and requires a fresh balance at least as high as the baseline', async () => {
  const client = createQueryClient()
  const id = FIXED_EXPEDITION_IDS.resolvedFailure
  let balance = 240
  server.server.use(
    http.get(`/api/expedition/expeditions/${id}`, () => {
      client.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
      })
      return HttpResponse.json(
        createResolvedExpedition(id, { status: 'FAILED', outcome: 'FAILURE' }),
      )
    }),
    http.get('/api/ship/ships/me', () =>
      HttpResponse.json(createHealthyShip({ materials_balance: balance })),
    ),
  )
  renderExpeditionRoute(`/expeditions/${id}`, client)
  await advanceUntil(() => screen.queryByText('Failed') !== null, 'failure result')
  expect(screen.getByText('0 materials')).toBeInTheDocument()
  await advanceUntil(() => screen.queryByText('Available materials: 240') !== null, 'lower balance')
  expect(screen.getByText('Updating…')).toBeInTheDocument()
  balance = 250
  await advanceUntil(
    () =>
      screen.queryByText('Available materials: 250') !== null &&
      screen.queryByText('Updating…') === null,
    'zero reward confirmation',
  )
})

it('does not confirm a zero failure reward without pre-resolution evidence', async () => {
  const id = FIXED_EXPEDITION_IDS.resolvedFailure
  server.server.use(
    http.get(`/api/expedition/expeditions/${id}`, () =>
      HttpResponse.json(createResolvedExpedition(id, { status: 'FAILED', outcome: 'FAILURE' })),
    ),
  )
  renderExpeditionRoute(`/expeditions/${id}`)
  await advanceUntil(() => screen.queryByText('Failed') !== null, 'failure result')
  await advanceUntil(() => screen.queryByText('Updating…') !== null, 'failure observation')
  await advanceFakeTime(10_000)
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
})

it('uses the downward threshold for a negative typed reward', async () => {
  const client = createQueryClient()
  const id = FIXED_EXPEDITION_IDS.resolvedSuccess
  const expedition = createResolvedExpedition(id)
  if (expedition.result === undefined) throw new Error('missing fixture result')
  let balance = 240
  server.server.use(
    http.get(`/api/expedition/expeditions/${id}`, () => {
      client.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
      })
      return HttpResponse.json({
        ...expedition,
        result: { ...expedition.result, material_reward: { materials: -15 } },
      })
    }),
    http.get('/api/ship/ships/me', () =>
      HttpResponse.json(createHealthyShip({ materials_balance: balance })),
    ),
  )
  renderExpeditionRoute(`/expeditions/${id}`, client)
  await advanceUntil(
    () => screen.queryByText('Available materials: 240') !== null,
    'partial decrease',
  )
  expect(screen.getByText('-15 materials')).toBeInTheDocument()
  expect(screen.getByText('Updating…')).toBeInTheDocument()
  balance = 235
  await advanceUntil(
    () =>
      screen.queryByText('Available materials: 235') !== null &&
      screen.queryByText('Updating…') === null,
    'negative reward threshold',
  )
})

it('observes aggregate balance thresholds when spending masks or another award satisfies the reward', async () => {
  const client = createQueryClient()
  const id = FIXED_EXPEDITION_IDS.resolvedSuccess
  let balance = 310
  server.server.use(
    http.get(`/api/expedition/expeditions/${id}`, () => {
      client.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
      })
      return HttpResponse.json(createResolvedExpedition(id))
    }),
    http.get('/api/ship/ships/me', () =>
      HttpResponse.json(createHealthyShip({ materials_balance: balance })),
    ),
  )
  renderExpeditionRoute(`/expeditions/${id}`, client)
  await advanceUntil(
    () => screen.queryByText('Available materials: 310') !== null,
    'spending masks reward',
  )
  expect(screen.getByText('Updating…')).toBeInTheDocument()
  balance = 330
  await advanceUntil(
    () =>
      screen.queryByText('Available materials: 330') !== null &&
      screen.queryByText('Updating…') === null,
    'aggregate award reaches threshold',
  )
})

it('clears the expectation and aborts an in-flight read without publishing a late response', async () => {
  const client = createQueryClient()
  const id = FIXED_EXPEDITION_IDS.resolvedSuccess
  let release = () => {}
  let aborted = false
  let started = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  server.server.use(
    http.get(`/api/expedition/expeditions/${id}`, () => {
      client.setQueryData(shipQueryKey, {
        kind: 'ready',
        ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
      })
      return HttpResponse.json(createResolvedExpedition(id))
    }),
    http.get('/api/ship/ships/me', async ({ request }) => {
      started = true
      request.signal.addEventListener('abort', () => {
        aborted = true
      })
      await gate
      return HttpResponse.json(createHealthyShip({ materials_balance: 330 }))
    }),
  )
  renderExpeditionRoute(`/expeditions/${id}`, client)
  await advanceUntil(() => started, 'pending Ship read')
  expect(getExpeditionRewards().has(id)).toBe(true)
  act(() => {
    clearDownstreamObservations()
  })
  expect(aborted).toBe(true)
  expect(getExpeditionRewards().has(id)).toBe(false)
  expect(downstreamObservationPhase(expeditionRewardKey(id))).toBe('idle')
  act(() => {
    release()
  })
  await advanceFakeTime(1_000)
  expect(client.getQueryData(shipQueryKey)).toEqual({
    kind: 'ready',
    ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
  })
  expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  expect(getExpeditionRewards().has(id)).toBe(false)
})

it('does not restart a settled result across Dashboard, overview and detail', async () => {
  const client = createQueryClient()
  const id = FIXED_EXPEDITION_IDS.resolvedSuccess
  let balance = 250
  let reads = 0
  server.server.use(
    http.get('/api/expedition/expeditions/current', () => {
      if (client.getQueryData(shipQueryKey) === undefined) {
        client.setQueryData(shipQueryKey, {
          kind: 'ready',
          ship: createHealthyShip({ materials_balance: 250, updated_at: '2020-01-01T00:00:00Z' }),
        })
      }
      return HttpResponse.json(createResolvedExpedition(id))
    }),
    http.get(`/api/expedition/expeditions/${id}`, () =>
      HttpResponse.json(createResolvedExpedition(id)),
    ),
    http.get('/api/ship/ships/me', () => {
      reads += 1
      return HttpResponse.json(
        createHealthyShip({ materials_balance: balance, updated_at: '2020-01-01T00:00:00Z' }),
      )
    }),
  )
  renderExpeditionRoute('/dashboard', client)
  await advanceUntil(() => screen.queryByText('Updating…') !== null, 'Dashboard reward')
  balance = 330
  await advanceUntil(
    () => downstreamObservationPhase(expeditionRewardKey(id)) === 'idle',
    'settled reward',
  )
  fireEvent.click(screen.getByRole('link', { name: 'Go to Expeditions' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Expeditions' }) !== null,
    'overview',
  )
  await advanceUntil(() => screen.queryByText('+80 materials') !== null, 'overview result')
  await advanceFakeTime(300)
  expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  let settledReads = reads
  await advanceFakeTime(1_500)
  expect(reads).toBe(settledReads)
  fireEvent.click(screen.getByRole('link', { name: 'History' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Expedition history' }) !== null,
    'history',
  )
  fireEvent.click(screen.getByRole('link', { name: /Success/ }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Expedition detail' }) !== null,
    'detail',
  )
  await advanceFakeTime(300)
  expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  settledReads = reads
  await advanceFakeTime(1_500)
  expect(reads).toBe(settledReads)
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Dashboard' }) !== null,
    'Dashboard again',
  )
  await advanceFakeTime(300)
  expect(screen.queryByText('Updating…')).not.toBeInTheDocument()
  settledReads = reads
  await advanceFakeTime(1_500)
  expect(reads).toBe(settledReads)
})

it('keeps a pending reward observable while the Ship page is visible', async () => {
  renderExpeditionRoute(`/expeditions/${FIXED_EXPEDITION_IDS.resolvedSuccess}`)
  await advanceUntil(() => screen.queryByText('Updating…') !== null, 'pending detail reward')
  fireEvent.click(screen.getByRole('link', { name: 'Ship' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Ship', level: 1 }) !== null,
    'Ship page',
  )
  expect(screen.getByText('Updating…')).toBeInTheDocument()
  await advanceFakeTime(10_000)
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
})

it('does not register retrospective History rows', async () => {
  renderExpeditionRoute('/expeditions/history')
  await advanceUntil(() => screen.queryByRole('link', { name: /Success/ }) !== null, 'history rows')
  expect(getExpeditionRewards().size).toBe(0)
  await advanceFakeTime(2_000)
  expect(getExpeditionRewards().size).toBe(0)
})
