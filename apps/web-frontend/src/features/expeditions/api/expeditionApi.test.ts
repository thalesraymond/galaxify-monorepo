import { getCurrentExpedition } from './expeditionApi'
import { ApiTransport } from '@/api/transport'
import { describe, expect, it, vi } from 'vitest'

describe('getCurrentExpedition', () => {
  it.each([
    ['EXPEDITION_NOT_FOUND', { kind: 'none' }],
    ['EXPEDITION_SHIP_STATE_NOT_READY', { kind: 'not_ready' }],
  ])('maps %s into its typed outcome', async (code, expected) => {
    const transport = new ApiTransport({
      fetch: vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code, message: 'not available' } },
            { status: code === 'EXPEDITION_NOT_FOUND' ? 404 : 503 },
          ),
        ) as typeof globalThis.fetch,
    })

    await expect(getCurrentExpedition(transport)).resolves.toMatchObject(expected)
  })
})

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  })
}
