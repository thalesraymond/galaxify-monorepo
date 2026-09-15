import { zUserGetMeResponse, zUserUpdateMeResponse } from '@/api/generated/user/zod.gen'
import type { UpdateMeRequest } from '@/api/generated/user/types.gen'
import type { ApiTransport } from '@/api/transport'

export const profileQueryKey = ['profile'] as const

export function getProfile(transport: ApiTransport, signal?: AbortSignal) {
  return transport.request({
    service: 'user',
    path: '/users/me',
    response: zUserGetMeResponse,
    ...(signal === undefined ? {} : { signal }),
  })
}

export function updateProfile(transport: ApiTransport, body: UpdateMeRequest) {
  return transport.request({
    service: 'user',
    path: '/users/me',
    method: 'PATCH',
    body,
    response: zUserUpdateMeResponse,
  })
}
