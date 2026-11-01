import { act, render, screen } from '@testing-library/react'
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
import { useShipBalanceGate } from './useShipBalanceGate'

afterEach(() => {
  clearDownstreamObservations()
  vi.useRealTimers()
  delete (document as unknown as Record<string, unknown>).visibilityState
  delete (navigator as unknown as Record<string, unknown>).onLine
})

function Gate() {
  const gate = useShipBalanceGate()
  return <span>{gate.state}</span>
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
    let release: (response: Response) => void = () => {}
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve
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
    act(() => {
      release(
        new Response(JSON.stringify(createHealthyShip()), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
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
})
