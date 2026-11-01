import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import {
  downstreamObservationPhase,
  registerDownstreamObservation,
  useDownstreamObservation,
} from '@/shared/reconciliation'
import { createSessionTestHarness, type SessionTestHarness } from '@/test/sessionTestUtils'

import { SessionProvider, useSession } from './SessionProvider'

const KEY = 'test:session-boundary'

type PendingRead = { readonly signal: AbortSignal }

/** A hanging fresh read that rejects when its round is cancelled. */
function createPendingRead(): {
  read: (signal: AbortSignal) => Promise<never>
  calls: PendingRead[]
} {
  const calls: PendingRead[] = []
  const read = (signal: AbortSignal): Promise<never> =>
    new Promise<never>((_resolve, reject) => {
      calls.push({ signal })
      signal.addEventListener('abort', () => {
        reject(new Error('aborted'))
      })
    })
  return { read, calls }
}

/**
 * A visible observer of the expected change, plus the session status so the
 * test can wait for bootstrap without touching provider internals.
 */
function SessionProbe() {
  const { status } = useSession()
  useDownstreamObservation(KEY, true)
  return <div>{status}</div>
}

async function renderAuthenticated(harness: SessionTestHarness) {
  const queryClient = new QueryClient()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SessionProvider runtime={harness.runtime}>
        <SessionProbe />
      </SessionProvider>
    </QueryClientProvider>,
  )
  await screen.findByText('authenticated')
  return view
}

describe('SessionProvider session boundaries', () => {
  it('cancels pending observations when the account changes', async () => {
    const harness = createSessionTestHarness()
    const view = await renderAuthenticated(harness)
    const { read, calls } = createPendingRead()
    registerDownstreamObservation({ key: KEY, read, isSatisfied: () => false, publish: () => {} })
    expect(calls).toHaveLength(1)
    expect(downstreamObservationPhase(KEY)).toBe('updating')

    await act(async () => {
      await harness.runtime.manager.login({
        email: 'captain@galaxify.test',
        password: 'password123',
      })
    })

    expect(calls[0]?.signal.aborted).toBe(true)
    expect(downstreamObservationPhase(KEY)).toBe('idle')
    view.unmount()
  })

  it('cancels pending observations when the provider is disposed', async () => {
    const harness = createSessionTestHarness()
    const view = await renderAuthenticated(harness)
    const { read, calls } = createPendingRead()
    registerDownstreamObservation({ key: KEY, read, isSatisfied: () => false, publish: () => {} })
    expect(calls).toHaveLength(1)

    view.unmount()

    expect(calls[0]?.signal.aborted).toBe(true)
    expect(downstreamObservationPhase(KEY)).toBe('idle')
  })
})
