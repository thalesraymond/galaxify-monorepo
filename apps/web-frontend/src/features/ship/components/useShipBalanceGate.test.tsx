import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiTransport } from '@/api/transport'
import { createHealthyShip } from '@/mocks/fixtures'
import { TransportProvider } from '@/shared/api/TransportContext'
import {
  clearDownstreamObservations,
  downstreamReconciliation,
  markBalanceGateExpired,
  registerBalanceGateKey,
  registerDownstreamObservation,
} from '@/shared/reconciliation'
import { advanceFake, enableFakeTimers, waitForUi } from '@/test/fakeTimers'
import { shipQueryKey, type ShipState } from '../api/shipApi'
import { useShipBalanceGate } from './useShipBalanceGate'

afterEach(() => {
  clearDownstreamObservations()
  vi.useRealTimers()
  delete (document as unknown as Record<string, unknown>).visibilityState
  delete (navigator as unknown as Record<string, unknown>).onLine
})

function Gate() {
  const gate = useShipBalanceGate()
  return (
    <>
      <span>{gate.state}</span>
      <button type="button" onClick={gate.retry}>
        Retry
      </button>
    </>
  )
}

/** Fetch that rejects when its abort signal fires, like the browser fetch. */
function abortAwareFetch(init: RequestInit | undefined, reject: (reason: unknown) => void): void {
  const signal = init?.signal
  const abort = (): void => {
    reject(new DOMException('aborted', 'AbortError'))
  }
  if (signal?.aborted === true) {
    abort()
    return
  }
  signal?.addEventListener('abort', abort, { once: true })
}

describe('Ship balance gate availability', () => {
  it('abandons a read hidden in flight and resumes once visible', async () => {
    enableFakeTimers(1_000_000)
    const stop = downstreamReconciliation.subscribe('daily:test:award', () => {})
    registerBalanceGateKey('daily:test:award')
    registerDownstreamObservation({
      key: 'daily:test:award',
      read: () => new Promise(() => {}),
      isSatisfied: () => false,
      publish: () => {},
    })
    await advanceFake(6_000)
    stop()
    markBalanceGateExpired()
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal
            const abort = (): void => {
              reject(new DOMException('aborted', 'AbortError'))
            }
            if (signal?.aborted === true) {
              abort()
              return
            }
            signal?.addEventListener('abort', abort, { once: true })
          }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify(createHealthyShip()), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TransportProvider transport={new ApiTransport({ fetch })}>
          <Gate />
        </TransportProvider>
      </QueryClientProvider>,
    )
    await waitForUi(() => fetch.mock.calls.length === 1)
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await advanceFake(10_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await waitForUi(() => fetch.mock.calls.length === 2)
    await waitForUi(() => screen.queryByText('open') !== null)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it.each(['hidden', 'offline'] as const)(
    'waits for %s before making its expiry read',
    async (pause) => {
      enableFakeTimers(1_000_000)
      const stop = downstreamReconciliation.subscribe('daily:test:award', () => {})
      registerBalanceGateKey('daily:test:award')
      registerDownstreamObservation({
        key: 'daily:test:award',
        read: () => new Promise(() => {}),
        isSatisfied: () => false,
        publish: () => {},
      })
      await advanceFake(6_000)
      expect(downstreamReconciliation.getPhase('daily:test:award')).toBe('delayed')
      stop()
      markBalanceGateExpired()
      if (pause === 'hidden')
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
      else Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(JSON.stringify(createHealthyShip()), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={client}>
          <TransportProvider transport={new ApiTransport({ fetch })}>
            <Gate />
          </TransportProvider>
        </QueryClientProvider>,
      )
      await advanceFake(10_000)
      expect(fetch).not.toHaveBeenCalled()
      expect(screen.getByText('refreshing')).toBeInTheDocument()
      act(() => {
        if (pause === 'hidden') {
          Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
          })
          document.dispatchEvent(new Event('visibilitychange'))
        } else {
          Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
          window.dispatchEvent(new Event('online'))
        }
      })
      await waitForUi(() => screen.queryByText('open') !== null)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('never opens from a retained cache when the shared read is cancelled', async () => {
    enableFakeTimers(1_000_000)
    const stop = downstreamReconciliation.subscribe('daily:test:award', () => {})
    registerBalanceGateKey('daily:test:award')
    registerDownstreamObservation({
      key: 'daily:test:award',
      read: () => new Promise(() => {}),
      isSatisfied: () => false,
      publish: () => {},
    })
    await advanceFake(6_000)
    expect(downstreamReconciliation.getPhase('daily:test:award')).toBe('delayed')
    stop()

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Confirmed facts from before this expiry generation: they may be rendered
    // but can never approve the gate.
    client.setQueryData(shipQueryKey, {
      kind: 'ready',
      ship: createHealthyShip({ materials_balance: 250 }),
    } satisfies ShipState)
    await advanceFake(1)
    markBalanceGateExpired()

    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            abortAwareFetch(init, reject)
          }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify(createHealthyShip({ materials_balance: 260 })), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    render(
      <QueryClientProvider client={client}>
        <TransportProvider transport={new ApiTransport({ fetch })}>
          <Gate />
        </TransportProvider>
      </QueryClientProvider>,
    )
    await waitForUi(() => fetch.mock.calls.length === 1)

    // A cancelled/reverted shared read leaves the retained balance in place;
    // the gate must fail closed instead of approving from it.
    act(() => {
      void client.cancelQueries({ queryKey: shipQueryKey, exact: true })
    })
    await waitForUi(() => screen.queryByText('stale') !== null)
    expect(screen.queryByText('open')).not.toBeInTheDocument()
    expect(client.getQueryData(shipQueryKey)).toMatchObject({
      kind: 'ready',
      ship: { materials_balance: 250 },
    })

    // A player-initiated retry performs a fresh authoritative read.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitForUi(() => screen.queryByText('open') !== null)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
