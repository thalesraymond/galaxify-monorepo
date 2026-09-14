import { getShip } from './shipApi'
import { ApiTransport } from '@/api/transport'
import { describe, expect, it, vi } from 'vitest'

describe('getShip', () => {
  it('maps a missing Ship into a provisioning outcome', async () => {
    const transport = new ApiTransport({
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'SHIP_NOT_FOUND', message: 'Ship has not been provisioned' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as typeof globalThis.fetch,
    })

    await expect(getShip(transport)).resolves.toMatchObject({ kind: 'provisioning' })
  })
})
