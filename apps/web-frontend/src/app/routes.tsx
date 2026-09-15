import { lazy, Suspense, type ComponentType, type ReactElement } from 'react'

import { type RouteObject } from 'react-router'

import { RedirectIfAuthenticated, RequireAuth } from '@/features/auth'
import { RouteFallback } from '@/shared/ui/RouteFallback'
import { AppErrorBoundary } from './error/AppErrorBoundary'
import { HomeRedirect } from './pages/HomeRedirect'
import { NotFoundPage } from './pages/NotFoundPage'
import { AppShell } from './shell/AppShell'
import { AuthShell } from './shell/AuthShell'

/**
 * Wraps a lazily loaded route module in a suspense boundary so each route is
 * its own chunk. Feature routes are imported through their public entry point
 * (`@/features/<feature>`) — never through a deep path.
 */
function lazyRoute(load: () => Promise<{ default: ComponentType }>): ReactElement {
  const RouteComponent = lazy(load)

  return (
    <Suspense fallback={<RouteFallback />}>
      <RouteComponent />
    </Suspense>
  )
}

export const routes: RouteObject[] = [
  { path: '/', element: <HomeRedirect /> },
  {
    path: '/__design-system-preview',
    element: lazyRoute(() =>
      import('./pages/DesignSystemPreviewPage').then((module) => ({
        default: module.DesignSystemPreviewPage,
      })),
    ),
  },
  {
    // Auth routes: authenticated visits redirect to the preserved return route.
    element: <RedirectIfAuthenticated />,
    errorElement: <AppErrorBoundary />,
    children: [
      {
        element: <AuthShell />,
        children: [
          {
            path: '/signup',
            element: lazyRoute(() =>
              import('@/features/auth').then((module) => ({ default: module.SignupPage })),
            ),
          },
          {
            path: '/login',
            element: lazyRoute(() =>
              import('@/features/auth').then((module) => ({ default: module.LoginPage })),
            ),
          },
        ],
      },
    ],
  },
  {
    // Protected routes: nothing renders until bootstrap resolves.
    element: <RequireAuth />,
    errorElement: <AppErrorBoundary />,
    children: [
      {
        element: <AppShell />,
        children: [
          {
            path: '/dashboard',
            element: lazyRoute(() =>
              import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
            ),
          },
          {
            path: '/dailies',
            element: lazyRoute(() =>
              import('@/features/dailies').then((module) => ({ default: module.DailiesListPage })),
            ),
          },
          {
            path: '/dailies/new',
            element: lazyRoute(() =>
              import('@/features/dailies').then((module) => ({ default: module.NewDailyPage })),
            ),
          },
          {
            path: '/dailies/:dailyId/edit',
            element: lazyRoute(() =>
              import('@/features/dailies').then((module) => ({ default: module.EditDailyPage })),
            ),
          },
          {
            path: '/dailies/history',
            element: lazyRoute(() =>
              import('@/features/dailies').then((module) => ({ default: module.DailyHistoryPage })),
            ),
          },
          {
            path: '/ship',
            element: lazyRoute(() =>
              import('@/features/ship').then((module) => ({ default: module.ShipPage })),
            ),
          },
          {
            path: '/expeditions',
            element: lazyRoute(() =>
              import('@/features/expeditions').then((module) => ({
                default: module.ExpeditionsPage,
              })),
            ),
          },
          {
            path: '/expeditions/history',
            element: lazyRoute(() =>
              import('@/features/expeditions').then((module) => ({
                default: module.ExpeditionHistoryPage,
              })),
            ),
          },
          {
            path: '/expeditions/:expeditionId',
            element: lazyRoute(() =>
              import('@/features/expeditions').then((module) => ({
                default: module.ExpeditionDetailPage,
              })),
            ),
          },
          {
            path: '/profile',
            element: lazyRoute(() =>
              import('@/features/profile').then((module) => ({ default: module.ProfilePage })),
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
