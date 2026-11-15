import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AppErrorBoundary } from '@/app/error/AppErrorBoundary'

function BrokenRoute(): never {
  throw new Error('Daily service unavailable')
}

function RouteResponseError(): never {
  // React Router models HTTP failures as thrown Response objects.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw new Response('Not Found', { status: 404, statusText: 'Not Found' })
}

describe('AppErrorBoundary', () => {
  it('renders a labeled recovery state for a thrown Error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const router = createMemoryRouter(
      [{ path: '/', element: <BrokenRoute />, errorElement: <AppErrorBoundary /> }],
      { initialEntries: ['/'] },
    )

    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Daily service unavailable')).toBeInTheDocument()

    consoleError.mockRestore()
  })

  it('describes a route error response by status', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const router = createMemoryRouter(
      [
        {
          path: '/',
          loader: RouteResponseError,
          errorElement: <AppErrorBoundary />,
        },
      ],
      { initialEntries: ['/'] },
    )

    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toBeInTheDocument()
    expect(screen.getByText('404 Not Found')).toBeInTheDocument()

    consoleError.mockRestore()
  })

  it('recovers from a route error back to Dashboard via Back to Dashboard', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const user = userEvent.setup()

    const router = createMemoryRouter(
      [
        {
          errorElement: <AppErrorBoundary />,
          children: [
            { path: '/broken', element: <BrokenRoute /> },
            { path: '/dashboard', element: <h1>Dashboard</h1> },
          ],
        },
      ],
      { initialEntries: ['/broken'] },
    )

    render(<RouterProvider router={router} />)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Back to Dashboard' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()

    consoleError.mockRestore()
  })
})
