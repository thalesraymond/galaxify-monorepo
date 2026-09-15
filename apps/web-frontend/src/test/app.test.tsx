import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderAppAt } from './renderApp'
import {
  createAnonymousSessionRuntime,
  createAuthenticatedSessionRuntime,
} from './sessionTestUtils'

const primaryNavLabels = ['Dashboard', 'Dailies', 'Ship', 'Expeditions'] as const

const shellRoutes = [
  { path: '/dashboard', heading: 'Dashboard' },
  { path: '/dailies', heading: 'Dailies' },
  { path: '/dailies/new', heading: 'Create a Daily' },
  { path: '/dailies/history', heading: 'Daily history' },
  { path: '/dailies/daily-123/edit', heading: 'Edit a Daily' },
  { path: '/ship', heading: 'Ship' },
  { path: '/expeditions', heading: 'Expeditions' },
  { path: '/expeditions/history', heading: 'Expedition history' },
  { path: '/expeditions/expedition-456', heading: 'Expedition detail' },
  { path: '/profile', heading: 'Profile' },
] as const

const authRoutes = [
  { path: '/signup', heading: 'Create your account' },
  { path: '/login', heading: 'Sign in' },
] as const

describe('application shell and route tree', () => {
  it('exposes the skip link and primary navigation on authenticated shell routes', async () => {
    renderAppAt('/dashboard', { sessionRuntime: createAuthenticatedSessionRuntime() })

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main-content',
    )

    const primaryNav = screen.getByRole('navigation', { name: /primary/i })
    for (const label of primaryNavLabels) {
      expect(within(primaryNav).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument()
  })

  it.each(shellRoutes)(
    'renders $path with one $heading heading in the app shell',
    async ({ path, heading }) => {
      renderAppAt(path, { sessionRuntime: createAuthenticatedSessionRuntime() })

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
      expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument()
    },
  )

  it.each(authRoutes)('renders $path in the focused auth shell', async ({ path, heading }) => {
    renderAppAt(path, { sessionRuntime: createAnonymousSessionRuntime() })

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#auth-main',
    )
    expect(screen.queryByRole('navigation', { name: /primary/i })).not.toBeInTheDocument()
  })

  it('navigates between primary routes through the nav links', async () => {
    const user = userEvent.setup()
    renderAppAt('/dashboard', { sessionRuntime: createAuthenticatedSessionRuntime() })
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })

    const primaryNav = screen.getByRole('navigation', { name: /primary/i })
    await user.click(within(primaryNav).getByRole('link', { name: 'Dailies' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Dailies' })).toBeInTheDocument()
  })

  it('redirects the root route to signup for anonymous visitors', async () => {
    renderAppAt('/', { sessionRuntime: createAnonymousSessionRuntime() })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument()
  })

  it('redirects an authenticated visit to the root route to Dashboard', async () => {
    renderAppAt('/', { sessionRuntime: createAuthenticatedSessionRuntime() })

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('renders a contextual not-found state inside the app shell', async () => {
    renderAppAt('/this-route-does-not-exist', {
      sessionRuntime: createAuthenticatedSessionRuntime(),
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument()
  })
})
