import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import { createMockTestServer, onUnhandledMockRequest } from '@/mocks'
import { renderAppAt } from '@/test/renderApp'
import { seedAuthenticatedSession } from '@/test/sessionTestUtils'

const server = createMockTestServer({ scenario: 'established-player' })

beforeAll(() => {
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
})

afterEach(() => {
  server.server.resetHandlers()
  server.reset()
})

afterAll(() => {
  server.stop()
})

beforeEach(async () => {
  window.localStorage.clear()
  await seedAuthenticatedSession()
})

async function renderProfile() {
  renderAppAt('/profile')
  expect(await screen.findByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument()
  expect(await screen.findByText('captain@galaxify.test')).toBeInTheDocument()
}

describe('Profile page', () => {
  it('shows read-only email and member-since with an editable username', async () => {
    await renderProfile()

    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText('Member since')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveValue('captain-logs')
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument()
  })

  it('updates the username pessimistically and announces success', async () => {
    const user = userEvent.setup()
    await renderProfile()

    const username = screen.getByLabelText('Username')
    await user.clear(username)
    await user.type(username, 'nova-captain')
    await user.click(screen.getByRole('button', { name: 'Save username' }))

    expect(await screen.findByText('Your username was updated.')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveValue('nova-captain')
  })

  it('keeps username errors inline and accessible', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.patch('/api/user/users/me', () =>
        HttpResponse.json(
          { error: { code: 'USER_USERNAME_TAKEN', message: 'Username is already taken.' } },
          { status: 409 },
        ),
      ),
    )
    await renderProfile()

    const username = screen.getByLabelText('Username')
    await user.clear(username)
    await user.type(username, 'taken-name')
    await user.click(screen.getByRole('button', { name: 'Save username' }))

    const error = await screen.findByText('That username is already taken.')
    expect(username).toHaveAttribute('aria-invalid', 'true')
    expect(username).toHaveAccessibleDescription(
      expect.stringContaining('That username is already taken.'),
    )
    expect(error).toBeInTheDocument()
  })

  it('keeps the draft after a rejected update and succeeds on retry', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.patch(
        '/api/user/users/me',
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'USER_USERNAME_TAKEN',
                message: 'Username is already taken.',
              },
            },
            { status: 409 },
          ),
        { once: true },
      ),
    )
    await renderProfile()

    const username = screen.getByLabelText('Username')
    await user.clear(username)
    await user.type(username, 'taken-name')
    await user.click(screen.getByRole('button', { name: 'Save username' }))

    expect(await screen.findByText('That username is already taken.')).toBeInTheDocument()
    expect(username).toHaveValue('taken-name')

    await user.clear(username)
    await user.type(username, 'free-name')
    await user.click(screen.getByRole('button', { name: 'Save username' }))

    expect(await screen.findByText('Your username was updated.')).toBeInTheDocument()
    expect(username).toHaveValue('free-name')
  })

  it('validates the username client-side before contacting the server', async () => {
    const user = userEvent.setup()
    await renderProfile()

    const username = screen.getByLabelText('Username')
    await user.clear(username)
    await user.type(username, 'ab')
    await user.click(screen.getByRole('button', { name: 'Save username' }))

    expect(await screen.findByText('Username must be 3–30 characters.')).toBeInTheDocument()
  })

  it('requires a password before deleting and keeps the dialog open on failure', async () => {
    const user = userEvent.setup()
    await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account' })

    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    expect(await within(dialog).findByText('Enter your password to confirm.')).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveFocus()
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
  })

  it('keeps the draft and password focus after a rejected deletion, then retries', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.delete(
        '/api/user/users/me',
        () =>
          HttpResponse.json(
            {
              error: {
                code: 'USER_INVALID_CREDENTIALS',
                message: 'Password is incorrect.',
              },
            },
            { status: 401 },
          ),
        { once: true },
      ),
    )
    await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account' })
    const password = within(dialog).getByLabelText('Password')
    await waitFor(() => {
      expect(password).toHaveFocus()
    })
    await user.type(password, 'password123')
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    expect(await within(dialog).findByText('Password is incorrect.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Delete your account' })).toBeInTheDocument()
    expect(password).toHaveValue('password123')
    expect(password).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY)).toBeNull()
  })

  it('deletes the account, purges the session, and lands on signup without logout', async () => {
    const user = userEvent.setup()
    const logoutRequests: string[] = []
    server.server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.endsWith('/auth/logout')) {
        logoutRequests.push(request.url)
      }
    })
    await renderProfile()

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account' })
    await user.type(within(dialog).getByLabelText('Password'), 'password123')
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument()
    expect(window.localStorage.getItem(SESSION_REFRESH_STORAGE_KEY)).toBeNull()
    expect(logoutRequests).toEqual([])
  })
})

describe('session reuse across the Profile journey', () => {
  it('does not leak tokens into URLs or query state', async () => {
    await renderProfile()

    expect(window.location.href).not.toMatch(/token/i)
    // Only the dedicated refresh key is persisted.
    const persistedKeys = Array.from({ length: window.localStorage.length }, (_, index) =>
      window.localStorage.key(index),
    )
    expect(persistedKeys).toEqual([SESSION_REFRESH_STORAGE_KEY])
  })
})
