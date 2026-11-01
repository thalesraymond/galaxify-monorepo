import { render } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import { createMemoryRouter, type RouteObject } from 'react-router'

import { AppProviders } from '@/app/providers'
import { AppShell } from '@/app/shell/AppShell'
import { DashboardPage } from '@/app/pages/DashboardPage'
import { RequireAuth, type SessionRuntime } from '@/features/auth'
import { DailiesListPage } from '@/features/dailies'
import { ShipPage } from '@/app/pages/ShipPage'
import {
  ExpeditionDetailPage,
  ExpeditionHistoryPage,
  ExpeditionsPage,
} from '@/features/expeditions'

/**
 * Eager (non-lazy) expedition route tree for a narrow set of tests.
 *
 * Genuine blocker: Vitest fake timers stall Vite's dynamic-import promise
 * resolution, so `renderAppAt`'s lazy route boundaries never mount when fake
 * timers are active. A few journeys NEED fake timers from mount — the bounded
 * resolution poll (`refetchInterval` derived from resolve_at), the countdown
 * tick loop, stale-refresh through a failed poll, and the result-lag reconciliation
 * schedule are all scheduled at mount, so their timers must be fake from the
 * very first render. Everything else uses the canonical `renderAppAt` with
 * Date-only mocking and real timers.
 */
const expeditionRouteTree: RouteObject[] = [
  // Logout lands here; a lightweight stand-in keeps the eager tree complete
  // without mounting the real lazy login boundary. It sits outside the guard,
  // exactly like the real route table.
  { path: '/login', element: <div>Login</div> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/expeditions', element: <ExpeditionsPage /> },
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/ship', element: <ShipPage /> },
          { path: '/dailies', element: <DailiesListPage /> },
          { path: '/expeditions/history', element: <ExpeditionHistoryPage /> },
          { path: '/expeditions/:expeditionId', element: <ExpeditionDetailPage /> },
        ],
      },
    ],
  },
]

/** Renders the expedition subtree with fake timers already enabled. */
export function renderExpeditionRoute(
  path: string,
  queryClient?: QueryClient,
  sessionRuntime?: SessionRuntime,
) {
  const router = createMemoryRouter(expeditionRouteTree, { initialEntries: [path] })
  return render(
    <AppProviders router={router} queryClient={queryClient} sessionRuntime={sessionRuntime} />,
  )
}
