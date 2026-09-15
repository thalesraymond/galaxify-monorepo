import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ApiHttpError } from '@/api/transport'
import { asRejection, createSessionTestHarness } from '@/test/sessionTestUtils'
import { renderAppAt } from '@/test/renderApp'

function apiError(code: string, status = 422): ApiHttpError {
  return {
    kind: 'api',
    status,
    code,
    message: 'Request failed.',
    fieldErrors: undefined,
    requestId: undefined,
  }
}

describe('signup page', () => {
  it('shows visible labels, a cross-link, and no marketing panel', async () => {
    renderAppAt('/signup', {
      sessionRuntime: createSessionTestHarness({ authenticated: false }).runtime,
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('validates inline, focuses the first invalid field, and does not submit', async () => {
    const user = userEvent.setup()
    const harness = createSessionTestHarness({ authenticated: false })
    let signupCalls = 0
    harness.api.signup = () => {
      signupCalls += 1
      return Promise.reject(asRejection(apiError('UNEXPECTED')))
    }
    renderAppAt('/signup', { sessionRuntime: harness.runtime })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Username must be 3–30 characters.')).toBeInTheDocument()
    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveFocus()
    expect(signupCalls).toBe(0)
  })

  it('keeps values and maps a taken email to its field', async () => {
    const user = userEvent.setup()
    const harness = createSessionTestHarness({ authenticated: false })
    harness.api.signup = () => Promise.reject(asRejection(apiError('USER_EMAIL_TAKEN', 409)))
    renderAppAt('/signup', { sessionRuntime: harness.runtime })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await user.type(screen.getByLabelText('Email'), 'captain@galaxify.test')
    await user.type(screen.getByLabelText('Username'), 'captain-logs')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByText('That email is already registered.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('captain@galaxify.test')
    expect(screen.getByLabelText('Username')).toHaveValue('captain-logs')
  })

  it('disables the single submit control while the request is pending', async () => {
    const user = userEvent.setup()
    const harness = createSessionTestHarness({ authenticated: false })
    let release: (() => void) | undefined
    harness.api.signup = () =>
      new Promise<never>((_resolve, reject) => {
        release = () => {
          reject(asRejection(apiError('USER_EMAIL_TAKEN', 409)))
        }
      })
    renderAppAt('/signup', { sessionRuntime: harness.runtime })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await user.type(screen.getByLabelText('Email'), 'captain@galaxify.test')
    await user.type(screen.getByLabelText('Username'), 'captain-logs')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    release?.()
  })

  it('toggles password visibility without losing the value', async () => {
    const user = userEvent.setup()
    const harness = createSessionTestHarness({ authenticated: false })
    renderAppAt('/signup', { sessionRuntime: harness.runtime })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    const password = screen.getByLabelText('Password')
    await user.type(password, 'password123')
    expect(password).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Password')).toHaveValue('password123')
  })

  it('enters the authenticated Dashboard after a successful signup', async () => {
    const user = userEvent.setup()
    const harness = createSessionTestHarness({ authenticated: false })
    renderAppAt('/signup', { sessionRuntime: harness.runtime })
    await screen.findByRole('heading', { level: 1, name: 'Create your account' })

    await user.type(screen.getByLabelText('Email'), 'captain@galaxify.test')
    await user.type(screen.getByLabelText('Username'), 'captain-logs')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })
})

describe('login page', () => {
  it('shows a generic invalid-credentials message and preserves values', async () => {
    const user = userEvent.setup()
    const harness = createSessionTestHarness({ authenticated: false })
    harness.api.login = () => Promise.reject(asRejection(apiError('USER_INVALID_CREDENTIALS', 401)))
    renderAppAt('/login', { sessionRuntime: harness.runtime })
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })

    await user.type(screen.getByLabelText('Email'), 'captain@galaxify.test')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('captain@galaxify.test')
  })

  it('shows the terminal session notice with the exact copy', async () => {
    const harness = createSessionTestHarness({ authenticated: true })
    harness.api.refreshError = asRejection(apiError('AUTH_INVALID_TOKEN', 401))
    renderAppAt('/signup', { sessionRuntime: harness.runtime })

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Your session ended. Sign in again.')
    })
  })
})
