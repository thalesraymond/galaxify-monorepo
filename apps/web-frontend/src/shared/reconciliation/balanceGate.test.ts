import { afterEach, expect, it, vi } from 'vitest'

import { clearDownstreamObservations } from './downstreamReconciliation'
import {
  getBalanceGateExpiry,
  getBalanceGateExpirySnapshot,
  getBalanceGateKeys,
  markBalanceGateExpired,
  registerBalanceGateKey,
  subscribeToBalanceGateExpiry,
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

it('starts a new generation for every expiry, even for the same delayed key', () => {
  const listener = vi.fn()
  const unsubscribe = subscribeToBalanceGateExpiry(listener)
  registerBalanceGateKey('daily:one:award')
  expect(getBalanceGateExpirySnapshot()).toBe('|0')
  markBalanceGateExpired()
  expect(getBalanceGateExpiry().generation).toBe(1)
  markBalanceGateExpired()
  expect(getBalanceGateExpiry().generation).toBe(2)
  expect(listener).toHaveBeenCalledTimes(2)

  unregisterBalanceGateKey('daily:one:award')
  expect(getBalanceGateExpiry()).toEqual({ epoch: undefined, generation: 0 })
  expect(getBalanceGateExpirySnapshot()).toBe('|0')

  clearDownstreamObservations()
  unsubscribe()
})
