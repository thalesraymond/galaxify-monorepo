import {
  zAuthSessionResponse,
  zRefreshResponse,
  zUserDeleteMeResponse,
  zUserGetMeResponse,
  zUserLogoutResponse,
} from '@/api/generated/user/zod.gen'
import type {
  AuthSessionResponse,
  LoginRequest,
  RefreshResponse,
  SignupRequest,
  UserResponse,
} from '@/api/generated/user/types.gen'
import type { ApiTransport } from '@/api/transport'

/**
 * The User Service operations the session layer owns. Adapters branch on typed
 * error codes from the transport, never on status alone (`web-frontend.md` §7).
 */
export interface SessionApi {
  signup(input: SignupRequest): Promise<AuthSessionResponse>
  login(input: LoginRequest): Promise<AuthSessionResponse>
  refresh(refreshToken: string): Promise<RefreshResponse>
  logout(refreshToken: string, signal?: AbortSignal): Promise<void>
  deleteAccount(password: string): Promise<void>
  getMe(): Promise<UserResponse>
}

export function createSessionApi(transport: ApiTransport): SessionApi {
  return {
    signup: (input) =>
      transport.request({
        service: 'user',
        path: '/users',
        method: 'POST',
        body: input,
        response: zAuthSessionResponse,
      }),
    login: (input) =>
      transport.request({
        service: 'user',
        path: '/auth/login',
        method: 'POST',
        body: input,
        response: zAuthSessionResponse,
      }),
    refresh: (refreshToken) =>
      transport.request({
        service: 'user',
        path: '/auth/refresh',
        method: 'POST',
        body: { refresh_token: refreshToken },
        response: zRefreshResponse,
      }),
    logout: (refreshToken, signal) =>
      transport.request({
        service: 'user',
        path: '/auth/logout',
        method: 'POST',
        body: { refresh_token: refreshToken },
        response: zUserLogoutResponse,
        ...(signal === undefined ? {} : { signal }),
      }),
    deleteAccount: (password) =>
      transport.request({
        service: 'user',
        path: '/users/me',
        method: 'DELETE',
        body: { password },
        response: zUserDeleteMeResponse,
      }),
    getMe: () =>
      transport.request({
        service: 'user',
        path: '/users/me',
        response: zUserGetMeResponse,
      }),
  }
}
