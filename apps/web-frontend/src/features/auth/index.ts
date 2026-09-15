import { SessionBootstrap } from './components/SessionBootstrap'
import { SessionUnavailable } from './components/SessionUnavailable'
import { RedirectIfAuthenticated } from './guards/RedirectIfAuthenticated'
import { RequireAuth } from './guards/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { createSessionRuntime, SessionProvider, useSession } from './session/SessionProvider'

export { LoginPage, SignupPage, RequireAuth, RedirectIfAuthenticated }
export { SessionBootstrap, SessionUnavailable }
export { SessionProvider, useSession, createSessionRuntime }
export { SESSION_REFRESH_STORAGE_KEY } from './session/refreshTokenStorage'
export type { SessionRuntime, SessionRuntimeOverrides } from './session/SessionProvider'
export type { SessionEndNotice, SessionSnapshot, SessionStatus } from './session/sessionManager'
export { describeSessionNotice } from './components/SessionNotice'
