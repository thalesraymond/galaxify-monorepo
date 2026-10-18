import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiTransport } from '@/api/transport'
import { createDamagedShip } from '@/mocks'

import { shipQueryKey, type ShipState } from './shipApi'
import { observeShip, repairShipAndCache } from './shipQueries'

let queryClient: QueryClient

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1, gcTime: Infinity } },
  })
})

afterEach(() => {
  queryClient.clear()
})

describe('Ship observation ownership', () => {
  it('refreshes even a fresh cache and publishes the full confirmed snapshot', async () => {
    queryClient.setQueryData(shipQueryKey, {
      kind: 'ready',
      ship: createDamagedShip({ materials_balance: 150 }),
    } satisfies ShipState)
    const ship = createDamagedShip({ hull_health: 100, materials_balance: 62 })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(jsonResponse(ship))

    await expect(observeShip(queryClient, new ApiTransport({ fetch }))).resolves.toEqual({
      kind: 'ready',
      ship,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(shipQueryKey)).toEqual({ kind: 'ready', ship })
  })

  it('shares overlapping reads, but starts a fresh request for the next observation', async () => {
    const response = deferred<Response>()
    const ship = createDamagedShip()
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValueOnce(response.promise)
    const transport = new ApiTransport({ fetch })

    const first = observeShip(queryClient, transport)
    const second = observeShip(queryClient, transport)
    expect(fetch).toHaveBeenCalledTimes(1)

    response.resolve(jsonResponse(ship))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'ready', ship },
      { kind: 'ready', ship },
    ])

    const updated = createDamagedShip({ materials_balance: 130 })
    fetch.mockResolvedValueOnce(jsonResponse(updated))
    await expect(observeShip(queryClient, transport)).resolves.toEqual({
      kind: 'ready',
      ship: updated,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(queryClient.getQueryData(shipQueryKey)).toEqual({ kind: 'ready', ship: updated })
  })

  it('publishes the typed provisioning outcome without manufacturing a balance', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: 'SHIP_NOT_FOUND', message: 'Ship has not been provisioned' } },
          404,
        ),
      )

    await expect(observeShip(queryClient, new ApiTransport({ fetch }))).resolves.toMatchObject({
      kind: 'provisioning',
    })
    expect(queryClient.getQueryData(shipQueryKey)).toMatchObject({ kind: 'provisioning' })
  })

  it('retains confirmed data on failure and leaves retries to the bounded schedule', async () => {
    const confirmed: ShipState = { kind: 'ready', ship: createDamagedShip() }
    queryClient.setQueryData(shipQueryKey, confirmed)
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Ship unavailable' } }, 500),
      )

    await expect(observeShip(queryClient, new ApiTransport({ fetch }))).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(shipQueryKey)).toEqual(confirmed)
    expect(queryClient.getQueryState(shipQueryKey)?.status).toBe('error')
  })

  it('cancels an older observation before publishing a confirmed repair', async () => {
    const response = deferred<Response>()
    const started = deferred<AbortSignal | null | undefined>()
    const repaired = createDamagedShip({ hull_health: 100, materials_balance: 62 })
    const transport = new ApiTransport({
      // Deliberately ignore abort when resolving the read: even an uncooperative
      // transport's late response must not overwrite the confirmed repair.
      fetch: (_input, init) => {
        if (init?.method === 'POST') {
          return Promise.resolve(jsonResponse(repaired))
        }
        started.resolve(init?.signal)
        return response.promise
      },
    })
    const observation = observeShip(queryClient, transport).catch((error: unknown) => error)
    const signal = await started.promise

    await expect(repairShipAndCache(queryClient, transport)).resolves.toEqual(repaired)
    expect(await observation).toMatchObject({ revert: true })
    expect(signal?.aborted).toBe(true)

    const lateResponse = jsonResponse(createDamagedShip())
    response.resolve(lateResponse)
    await vi.waitFor(() => {
      expect(lateResponse.bodyUsed).toBe(true)
    })
    expect(queryClient.getQueryData(shipQueryKey)).toEqual({ kind: 'ready', ship: repaired })
  })

  it('does not publish an unconfirmed repair when the command fails', async () => {
    const confirmed: ShipState = { kind: 'ready', ship: createDamagedShip() }
    queryClient.setQueryData(shipQueryKey, confirmed)
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse({ error: { code: 'INTERNAL_ERROR', message: 'Repair failed' } }, 500),
      )

    await expect(
      repairShipAndCache(queryClient, new ApiTransport({ fetch })),
    ).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(shipQueryKey)).toEqual(confirmed)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise not initialized')
  }
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
