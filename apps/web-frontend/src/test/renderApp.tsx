import { render, type RenderResult } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'

import { AppProviders } from '@/app/providers'
import { routes } from '@/app/routes'
import type { SessionRuntime } from '@/features/auth'

export type RenderAppOptions = {
  /** Injected session runtime so tests control the four-state model. */
  readonly sessionRuntime?: SessionRuntime
}

/**
 * Renders the real route tree and providers at `path` using a memory router,
 * so tests exercise the same shell, guards, and lazy route boundaries as the
 * browser.
 */
export function renderAppAt(path: string, options: RenderAppOptions = {}): RenderResult {
  const router = createMemoryRouter(routes, { initialEntries: [path] })

  return render(<AppProviders router={router} sessionRuntime={options.sessionRuntime} />)
}
