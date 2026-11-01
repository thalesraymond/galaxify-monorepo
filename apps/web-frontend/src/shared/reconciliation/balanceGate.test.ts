import { afterEach, expect, it, vi } from 'vitest'

import { clearDownstreamObservations } from './downstreamReconciliation'
import {
  getBalanceGateKeys,
  registerBalanceGateKey,
  subscribeToBalanceGateKeys,
  unregisterBalanceGateKey,
} from './balanceGate'

afterEach(() => {
  clearDownstreamObservations()
})

it('tracks independent balance observations and clears them with the session', () => {
  const listener = vi.fn()
  const unsubscribe = subscribeToBalanceGateKeys(listener)
  registerBalanceGateKey('first')
  registerBalanceGateKey('second')
  const snapshot = getBalanceGateKeys()
  expect(getBalanceGateKeys()).toBe(snapshot)
  unregisterBalanceGateKey('first')
  expect(getBalanceGateKeys()).toEqual(['second'])
  clearDownstreamObservations()
  expect(getBalanceGateKeys()).toEqual([])
  expect(listener).toHaveBeenCalledTimes(4)
  unsubscribe()
})
