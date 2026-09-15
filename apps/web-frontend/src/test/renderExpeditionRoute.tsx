import { render } from '@testing-library/react'
import { createMemoryRouter, type RouteObject } from 'react-router'

import { AppProviders } from '@/app/providers'
import { AppShell } from '@/app/shell/AppShell'
import { RequireAuth } from '@/features/auth'
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
 * tick loop, stale-refresh through a failed poll, and the result-lag probe
 * schedule are all scheduled at mount, so their timers must be fake from the
 * very first render. Everything else uses the canonical `renderAppAt` with
 * Date-only mocking and real timers.
 */
const expeditionRouteTree: RouteObject[] = [
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/expeditions', element: <ExpeditionsPage /> },
          { path: '/expeditions/history', element: <ExpeditionHistoryPage /> },
          { path: '/expeditions/:expeditionId', element: <ExpeditionDetailPage /> },
        ],
      },
    ],
  },
]

/** Renders the expedition subtree with fake timers already enabled. */
export function renderExpeditionRoute(path: string) {
  const router = createMemoryRouter(expeditionRouteTree, { initialEntries: [path] })
  return render(<AppProviders router={router} />)
}
