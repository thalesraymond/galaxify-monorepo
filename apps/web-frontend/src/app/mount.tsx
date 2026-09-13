import { StrictMode } from 'react'

import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'

import { AppProviders } from './providers'
import { routes } from './routes'

/**
 * Mounts the browser application. Kept separate from `main.tsx` so the browser
 * router and root cannot trap tests that build their own memory router.
 */
export function mountApp(container: HTMLElement): void {
  const router = createBrowserRouter(routes)

  createRoot(container).render(
    <StrictMode>
      <AppProviders router={router} />
    </StrictMode>,
  )
}
