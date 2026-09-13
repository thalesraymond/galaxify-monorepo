import { render, type RenderResult } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'

import { AppProviders } from '@/app/providers'
import { routes } from '@/app/routes'

/**
 * Renders the real route tree and providers at `path` using a memory router,
 * so tests exercise the same shell and lazy route boundaries as the browser.
 */
export function renderAppAt(path: string): RenderResult {
  const router = createMemoryRouter(routes, { initialEntries: [path] })

  return render(<AppProviders router={router} />)
}
