import { zUserGetMeResponse } from '@/api/generated/user/zod.gen'
import type { ApiTransport } from '@/api/transport'

export const profileQueryKey = ['profile'] as const

export function getProfile(transport: ApiTransport, signal?: AbortSignal) {
  return transport.request({
    service: 'user',
    path: '/users/me',
    response: zUserGetMeResponse,
    signal,
  })
}
