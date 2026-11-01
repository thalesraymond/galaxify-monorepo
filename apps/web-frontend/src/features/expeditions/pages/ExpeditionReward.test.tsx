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
import { clearDownstreamObservations } from '@/shared/reconciliation'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'
import { enableFakeTimers } from '@/test/fakeTimers'
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'

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
