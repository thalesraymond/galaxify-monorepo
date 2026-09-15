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
 * Eager (non-lazy) expedition route tree for tests that fake timers. Vitest's
 * fake timers stall Vite's dynamic-import promise resolution, so
 * `renderAppAt`'s lazy route boundaries never mount under fake timers; this
 * renders the same shell, guard, and providers with the pages loaded eagerly.
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

export function renderExpeditionRoute(path: string) {
  const router = createMemoryRouter(expeditionRouteTree, { initialEntries: [path] })
  return { ...render(<AppProviders router={router} />), router }
}
