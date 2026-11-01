process.env.TZ = 'UTC'

import { act, fireEvent, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/app/queryClient'
import { shipQueryKey } from '@/features/ship'
import {
  createDamagedShip,
  createMockTestServer,
  FIXED_MOCK_EPOCH_MS,
  ManualMockScheduler,
  onUnhandledMockRequest,
} from '@/mocks'
import {
  clearDownstreamObservations,
  downstreamReconciliation,
  getBalanceGateKeys,
} from '@/shared/reconciliation'
import { advanceFakeTime, advanceUntil, seedAuthenticatedSession } from '@/test/expeditionTestUtils'
import { enableFakeTimers } from '@/test/fakeTimers'
import { renderExpeditionRoute } from '@/test/renderExpeditionRoute'

const scheduler = new ManualMockScheduler(FIXED_MOCK_EPOCH_MS)
const server = createMockTestServer({ scenario: 'established-player', scheduler })
let balance = 250
let fail = false

beforeEach(async () => {
  clearDownstreamObservations()
  balance = 250
  fail = false
  server.reset()
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
  server.server.use(
    http.get('/api/ship/ships/me', () =>
      fail
        ? HttpResponse.error()
        : HttpResponse.json(createDamagedShip({ materials_balance: balance })),
    ),
  )
  window.localStorage.clear()
  vi.setSystemTime(FIXED_MOCK_EPOCH_MS)
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
  window.localStorage.clear()
})

async function startDaily(missingBaseline = false) {
  const client = createQueryClient()
  renderExpeditionRoute('/dashboard', client)
  await advanceUntil(
    () =>
      screen.queryByRole('button', { name: 'Complete Calibrate sensors' }) !== null &&
      screen.queryByRole('button', { name: 'Repair Ship' }) !== null,
    'Dashboard',
  )
  if (missingBaseline) client.removeQueries({ queryKey: shipQueryKey })
  fireEvent.click(screen.getByRole('button', { name: 'Complete Calibrate sensors' }))
  await advanceUntil(
    () => screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'balance gate',
  )
  return client
}

it('gates repair across Dashboard and Ship until the Daily award is observed', async () => {
  await startDaily()
  expect(screen.getByRole('button', { name: 'Repair Ship' })).toHaveAccessibleDescription(
    /balance is updating/i,
  )
  expect(screen.getByRole('button', { name: /Complete / })).toBeEnabled()
  fireEvent.click(screen.getByRole('link', { name: 'Ship' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { name: 'Ship', level: 1 }) !== null,
    'Ship route',
  )
  expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
  balance = 260
  await advanceFakeTime(1_500)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'settled award',
  )
})

it('releases repair on a fresh unchanged balance without clearing the delayed Daily', async () => {
  await startDaily()
  await advanceFakeTime(9_000)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'fresh balance',
  )
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
  expect(
    within(screen.getByRole('region', { name: "Today's Dailies" })).getByRole('button', {
      name: 'Retry',
    }),
  ).toBeEnabled()
})

it('keeps repair closed after the expiry read fails until the player retries', async () => {
  await startDaily()
  fail = true
  await advanceFakeTime(9_000)
  await advanceUntil(
    () =>
      screen.queryAllByText('The Ship balance could not be refreshed. Retry before using it.')
        .length > 0,
    'stale gate',
  )
  const repair = screen.getByRole('button', { name: 'Repair Ship' })
  expect(repair).toBeDisabled()
  expect(repair).toHaveAccessibleDescription(/could not be refreshed/)
  fail = false
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Materials' })).getByRole('button', {
      name: 'Retry',
    }),
  )
  await advanceUntil(() => !repair.hasAttribute('disabled'), 'retry success')
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
})

it('clears the closed gate at a session boundary', async () => {
  await startDaily()
  act(() => {
    clearDownstreamObservations()
  })
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'cleared gate',
  )
  expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeEnabled()
})

it('keeps repair gated until both independent Daily awards settle', async () => {
  await startDaily()
  fireEvent.click(screen.getByRole('button', { name: 'Complete Stretch the solar sails' }))
  await advanceUntil(
    () => screen.queryByRole('button', { name: 'Complete Stretch the solar sails' }) === null,
    'second completion',
  )
  balance = 260
  await advanceFakeTime(1_500)
  await advanceUntil(() => screen.queryAllByText('Ship materials: 260').length > 0, 'first award')
  expect(
    within(screen.getByRole('region', { name: "Today's Dailies" })).getAllByText('Updating…'),
  ).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
  balance = 300
  await advanceFakeTime(2_000)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'both awards',
  )
})

it('releases after a balance decrease without confirming an unobserved award', async () => {
  await startDaily()
  balance = 175
  await advanceFakeTime(9_000)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'current balance',
  )
  expect(screen.getByText('Ship materials: 175')).toBeInTheDocument()
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
})

it('gates Launch after navigating from a Daily and releases it on expiry', async () => {
  await startDaily()
  fireEvent.click(screen.getByRole('link', { name: 'Expeditions' }))
  await advanceUntil(() => screen.queryByLabelText('Materials to invest') !== null, 'launch form')
  fireEvent.change(screen.getByLabelText('Materials to invest'), { target: { value: '40' } })
  await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
  const launch = screen.getByRole('button', { name: 'Launch Expedition' })
  expect(launch).toBeDisabled()
  expect(launch).toHaveAccessibleDescription(/balance is updating/i)
  await advanceFakeTime(9_000)
  await advanceUntil(() => !launch.hasAttribute('disabled'), 'fresh launch balance')
})

it('opens after expiry and a fresh read when the Daily had no baseline', async () => {
  await startDaily(true)
  balance = 270
  await advanceFakeTime(9_000)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'fresh balance',
  )
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
  expect(screen.getByText('Ship materials: 270')).toBeInTheDocument()
})

it('shows a stale explanation and Retry on Launch when the expiry read fails', async () => {
  await startDaily()
  fireEvent.click(screen.getByRole('link', { name: 'Expeditions' }))
  await advanceUntil(() => screen.queryByLabelText('Materials to invest') !== null, 'launch form')
  fireEvent.change(screen.getByLabelText('Materials to invest'), { target: { value: '40' } })
  await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
  fail = true
  await advanceFakeTime(9_000)
  await advanceUntil(
    () =>
      screen.queryAllByText('The Ship balance could not be refreshed. Retry before using it.')
        .length > 0,
    'stale launch gate',
  )
  const launch = screen.getByRole('button', { name: 'Launch Expedition' })
  expect(launch).toBeDisabled()
  expect(launch).toHaveAccessibleDescription(/could not be refreshed/)
  expect(screen.getByText('Update delayed')).toBeInTheDocument()
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await advanceUntil(() => !launch.hasAttribute('disabled'), 'fresh retry')
})

it('does not let an expired session read release a newer Daily gate', async () => {
  let release = () => {}
  let started = false
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  server.server.use(
    http.get('/api/ship/ships/me', async () => {
      if (
        getBalanceGateKeys().some((key) => downstreamReconciliation.getPhase(key) === 'delayed')
      ) {
        started = true
        await held
      }
      return HttpResponse.json(createDamagedShip({ materials_balance: 250 }))
    }),
  )
  await startDaily()
  await advanceFakeTime(9_000)
  await advanceUntil(() => started, 'held expiry read')
  act(() => {
    clearDownstreamObservations()
  })
  fireEvent.click(screen.getByRole('button', { name: 'Complete Stretch the solar sails' }))
  await advanceUntil(
    () => screen.queryByRole('button', { name: 'Complete Stretch the solar sails' }) === null,
    'new completion',
  )
  await act(async () => {
    release()
    await Promise.resolve()
  })
  await advanceFakeTime(500)
  expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
})

it('releases Launch after expiry when the Daily lacked a baseline', async () => {
  await startDaily(true)
  balance = 270
  fireEvent.click(screen.getByRole('link', { name: 'Expeditions' }))
  await advanceUntil(() => screen.queryByLabelText('Materials to invest') !== null, 'launch form')
  fireEvent.change(screen.getByLabelText('Materials to invest'), { target: { value: '40' } })
  await advanceUntil(() => screen.queryByText('Ready to launch.') !== null, 'quote')
  const launch = screen.getByRole('button', { name: 'Launch Expedition' })
  expect(launch).toBeDisabled()
  await advanceFakeTime(9_000)
  await advanceUntil(() => !launch.hasAttribute('disabled'), 'fresh balance')
  expect(screen.getByText('You have 270 materials')).toBeInTheDocument()
})

it('times out a stalled expiry read and offers a local retry', async () => {
  let held = false
  server.server.use(
    http.get('/api/ship/ships/me', async () => {
      if (
        getBalanceGateKeys().some((key) => downstreamReconciliation.getPhase(key) === 'delayed')
      ) {
        held = true
        await new Promise(() => {})
      }
      return HttpResponse.json(createDamagedShip({ materials_balance: 250 }))
    }),
  )
  await startDaily()
  await advanceFakeTime(9_000)
  await advanceUntil(() => held, 'held expiry read')
  await advanceFakeTime(5_000)
  await advanceUntil(
    () =>
      screen.queryAllByText('The Ship balance could not be refreshed. Retry before using it.')
        .length > 0,
    'read timeout',
  )
  expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
  expect(
    within(screen.getByRole('region', { name: 'Materials' })).getByRole('button', {
      name: 'Retry',
    }),
  ).toBeEnabled()
})

it('does not treat retained Ship data as fresh after a failed refresh', async () => {
  const client = await startDaily()
  await advanceFakeTime(9_000)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'fresh balance',
  )
  fail = true
  act(() => {
    void client.invalidateQueries({ queryKey: shipQueryKey })
  })
  await advanceUntil(
    () => screen.queryByText('Showing the last known Ship status. Refreshing failed.') !== null,
    'failed refresh',
    100,
    200,
  )
  expect(screen.getByRole('button', { name: 'Repair Ship' })).toBeDisabled()
})

it('closes the released gate again when the Daily observation is retried', async () => {
  await startDaily()
  await advanceFakeTime(9_000)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'fresh balance',
  )
  fireEvent.click(
    within(screen.getByRole('region', { name: "Today's Dailies" })).getByRole('button', {
      name: 'Retry',
    }),
  )
  await advanceUntil(
    () => screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'restarted observation',
  )
  expect(screen.getByRole('button', { name: 'Repair Ship' })).toHaveAccessibleDescription(
    /balance is updating/,
  )
})

it('requires a fresh read after a retry expires while no gate surface is mounted', async () => {
  await startDaily()
  await advanceFakeTime(9_000)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'first expiry approval',
  )

  // The gate hook unmounts on Dailies; the completed row remains the observer
  // and the session registry must still record the retried round's expiry.
  fireEvent.click(screen.getByRole('link', { name: 'Dailies' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { level: 1, name: 'Dailies' }) !== null,
    'dailies route',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await advanceFakeTime(1_000)
  // Keep observation reads successful through the second expiry so the Ship
  // query still holds a fresh, successful pre-expiry snapshot.
  await advanceFakeTime(9_000)
  expect(screen.getByText('Update delayed')).toBeInTheDocument()

  // Fail only the gate's read after the new expiry. The old approval must not
  // release the gate from the still-successful cache.
  fail = true
  fireEvent.click(screen.getByRole('link', { name: 'Ship' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { level: 1, name: 'Ship' }) !== null,
    'ship route',
  )
  const repair = screen.getByRole('button', { name: 'Repair Ship' })
  expect(repair).toBeDisabled()
  await advanceUntil(
    () =>
      screen.queryAllByText('The Ship balance could not be refreshed. Retry before using it.')
        .length > 0,
    'second-expiry read failure',
  )
  expect(repair).toHaveAccessibleDescription(/could not be refreshed/)

  fail = false
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Materials' })).getByRole('button', {
      name: 'Retry',
    }),
  )
  await advanceUntil(() => !repair.hasAttribute('disabled'), 'second-expiry fresh read')
})

it('does not reuse an approval after the last key settles and a later expiry reuses a generation number', async () => {
  await startDaily()
  await advanceFakeTime(9_000)
  await advanceUntil(
    () => !screen.getByRole('button', { name: 'Repair Ship' }).hasAttribute('disabled'),
    'first expiry approval',
  )

  fireEvent.click(screen.getByRole('link', { name: 'Dailies' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { level: 1, name: 'Dailies' }) !== null,
    'dailies route',
  )

  // Retry and settle the first award so the registry has no keys left.
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  balance = 290
  await advanceUntil(() => screen.queryByText('Update delayed') === null, 'first award settled')

  // A later Daily expires after the no-key interval. Generations must stay
  // monotonic for the session, not restart at one.
  fireEvent.click(screen.getByRole('button', { name: 'Complete Stretch the solar sails' }))
  await advanceUntil(
    () => screen.queryByRole('button', { name: 'Complete Stretch the solar sails' }) === null,
    'second completion',
  )
  await advanceFakeTime(9_000)
  expect(screen.getByText('Update delayed')).toBeInTheDocument()

  fail = true
  fireEvent.click(screen.getByRole('link', { name: 'Ship' }))
  await advanceUntil(
    () => screen.queryByRole('heading', { level: 1, name: 'Ship' }) !== null,
    'ship route',
  )
  const repair = screen.getByRole('button', { name: 'Repair Ship' })
  expect(repair).toBeDisabled()
  await advanceUntil(
    () =>
      screen.queryAllByText('The Ship balance could not be refreshed. Retry before using it.')
        .length > 0,
    'new-generation read failure',
  )

  fail = false
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Materials' })).getByRole('button', {
      name: 'Retry',
    }),
  )
  await advanceUntil(() => !repair.hasAttribute('disabled'), 'new-generation fresh read')
})
