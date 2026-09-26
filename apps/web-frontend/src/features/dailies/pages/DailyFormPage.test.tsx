process.env.TZ = 'UTC'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_REFRESH_STORAGE_KEY } from '@/features/auth'
import { FIXED_DAILY_IDS, FIXED_MOCK_EPOCH_MS } from '@/mocks/fixtures'
import { createMockTestServer, onUnhandledMockRequest } from '@/mocks'
import { renderAppAt } from '@/test/renderApp'

const server = createMockTestServer({ scenario: 'established-player' })

beforeAll(() => {
  server.server.listen({ onUnhandledRequest: onUnhandledMockRequest })
})

afterEach(() => {
  server.server.resetHandlers()
  server.reset('established-player')
  vi.useRealTimers()
})

afterAll(() => {
  server.stop()
})

beforeEach(async () => {
  window.localStorage.clear()
  vi.setSystemTime(new Date(FIXED_MOCK_EPOCH_MS))
  await seedAuthenticatedSession()
})

async function seedAuthenticatedSession(): Promise<void> {
  const response = await fetch('/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
  })
  const body = (await response.json()) as { refresh_token: string }
  window.localStorage.setItem(
    SESSION_REFRESH_STORAGE_KEY,
    JSON.stringify({ version: 1, refreshToken: body.refresh_token }),
  )
}

async function renderAt(path: string, headingName: string): Promise<void> {
  renderAppAt(path)
  // The session bootstrap briefly renders its own heading; wait for the
  // route's specific h1.
  await screen.findByRole('heading', { level: 1, name: headingName })
}

async function fillValidNewDaily(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Title'), 'Check the star charts')
  await user.type(screen.getByLabelText('Description'), 'A nightly scan for drift.')
  await user.click(screen.getByRole('radio', { name: /Medium/ }))
}

describe('/dailies/new', () => {
  it('creates a recurring Daily from title, description and difficulty alone', async () => {
    const user = userEvent.setup()
    let submitted: Record<string, unknown> | undefined
    server.server.use(
      http.post('/api/daily/dailies', async ({ request }) => {
        submitted = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          { error: { code: 'TEST_CAPTURE', message: 'Captured.' } },
          { status: 400 },
        )
      }),
    )
    await renderAt('/dailies/new', 'Create a Daily')
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Due time')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Time zone')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Title'), 'Check the star charts')
    await user.type(screen.getByLabelText('Description'), 'Scan for drift')
    await user.click(screen.getByRole('radio', { name: /Medium/ }))
    await user.click(screen.getByRole('button', { name: 'Create Daily' }))
    await vi.waitFor(() => {
      expect(submitted).toEqual({
        title: 'Check the star charts',
        description: 'Scan for drift',
        difficulty: 'MEDIUM',
        time_zone: 'UTC',
      })
    })
  })
  it('creates a Daily, returns to its local date, and focuses the row', async () => {
    const user = userEvent.setup()
    await renderAt('/dailies/new', 'Create a Daily')
    expect(screen.getByRole('heading', { level: 1, name: 'Create a Daily' })).toBeInTheDocument()

    await fillValidNewDaily(user)
    await user.click(screen.getByRole('button', { name: 'Create Daily' }))

    // Returns to /dailies with the changed row identified and focused.
    const row = await screen.findByRole('heading', { level: 3, name: 'Check the star charts' })
    await vi.waitFor(() => {
      expect(row).toHaveFocus()
    })
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('Created Daily "Check the star charts".')).toBeInTheDocument()
  })

  it('validates required and length limits inline before submitting', async () => {
    const user = userEvent.setup()
    await renderAt('/dailies/new', 'Create a Daily')

    await user.click(screen.getByRole('button', { name: 'Create Daily' }))
    expect(await screen.findByText('Enter a title.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(
      expect.stringContaining('Enter a title.'),
    )

    const title = screen.getByLabelText('Title')
    fireEvent.change(title, { target: { value: 'X'.repeat(121) } })
    await user.click(screen.getByRole('button', { name: 'Create Daily' }))
    expect(await screen.findByText('Titles are limited to 120 characters.')).toBeInTheDocument()
  })

  it('maps backend field errors inline and preserves input', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.post('/api/daily/dailies', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Validation failed.',
              details: { field_errors: { title: 'Choose another title.' } },
            },
          },
          { status: 422 },
        ),
      ),
    )
    await renderAt('/dailies/new', 'Create a Daily')
    await fillValidNewDaily(user)
    await user.click(screen.getByRole('button', { name: 'Create Daily' }))

    expect(await screen.findByText('Choose another title.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(
      expect.stringContaining('Choose another title.'),
    )
    expect(screen.getByLabelText('Title')).toHaveValue('Check the star charts')
  })

  it('shows a form-level error for DAILY_PLAYER_NOT_READY', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.post('/api/daily/dailies', () =>
        HttpResponse.json(
          { error: { code: 'DAILY_PLAYER_NOT_READY', message: 'Daily state is provisioning.' } },
          { status: 503 },
        ),
      ),
    )
    await renderAt('/dailies/new', 'Create a Daily')
    await fillValidNewDaily(user)
    await user.click(screen.getByRole('button', { name: 'Create Daily' }))

    expect(
      await screen.findByText('Your Dailies are still being prepared. Try again in a moment.'),
    ).toBeInTheDocument()
  })

  it('warns before internal navigation when dirty and allows discarding', async () => {
    const user = userEvent.setup()
    await renderAt('/dailies/new', 'Create a Daily')

    await user.type(screen.getByLabelText('Title'), 'Unsaved edits')
    await user.click(screen.getByRole('link', { name: 'Back to Dailies' }))

    const dialog = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })
    expect(within(dialog).getByText(/Your edits have not been saved/i)).toBeInTheDocument()

    // Cancel keeps the form and its input.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Create a Daily' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Unsaved edits')

    // Confirming discards and navigates away.
    await user.click(screen.getByRole('link', { name: 'Back to Dailies' }))
    const dialogAgain = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })
    await user.click(within(dialogAgain).getByRole('button', { name: 'Discard changes' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dailies' })).toBeInTheDocument()
  })

  it('warns before unload only while the form is dirty', async () => {
    const user = userEvent.setup()
    await renderAt('/dailies/new', 'Create a Daily')

    const clean = new Event('beforeunload', { cancelable: true })
    fireEvent(window, clean)
    expect(clean.defaultPrevented).toBe(false)

    await user.type(screen.getByLabelText('Title'), 'Unsaved edits')
    const dirty = new Event('beforeunload', { cancelable: true })
    fireEvent(window, dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})

describe('/dailies/:dailyId/edit', () => {
  it('loads the Daily, updates it, and focuses the changed row', async () => {
    const user = userEvent.setup()
    await renderAt(`/dailies/${FIXED_DAILY_IDS.calibrate}/edit`, 'Edit a Daily')

    expect(await screen.findByLabelText('Title')).toHaveValue('Calibrate sensors')
    expect(screen.getByRole('radio', { name: /Easy/ })).toBeChecked()
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Due time')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Time zone')).not.toBeInTheDocument()

    const title = screen.getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Recalibrate sensors')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const row = await screen.findByRole('heading', { level: 3, name: 'Recalibrate sensors' })
    await vi.waitFor(() => {
      expect(row).toHaveFocus()
    })
    expect(screen.getByText('Updated Daily "Recalibrate sensors".')).toBeInTheDocument()
  })

  it('explains that editing a completed Daily only changes future recurrence', async () => {
    await renderAt(`/dailies/${FIXED_DAILY_IDS.hydrate}/edit`, 'Edit a Daily')
    expect(await screen.findByText('This Daily is already completed.')).toBeInTheDocument()
    expect(screen.getByText(/past outcomes in Daily history stay unchanged/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Edit a Daily' })).toBeInTheDocument()
  })

  it('renders a recovery state for a missing Daily with a way back', async () => {
    await renderAt('/dailies/00000000-0000-4000-8000-000000000099/edit', 'Daily not found')
    expect(
      await screen.findByRole('heading', { level: 2, name: 'This Daily does not exist' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Dailies' })).toBeInTheDocument()
  })

  it('shows Preparing… for DAILY_PLAYER_NOT_READY and recovers on Retry', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.get('/api/daily/dailies/:id', () =>
        HttpResponse.json(
          { error: { code: 'DAILY_PLAYER_NOT_READY', message: 'Daily state is provisioning.' } },
          { status: 503 },
        ),
      ),
    )
    await renderAt(`/dailies/${FIXED_DAILY_IDS.calibrate}/edit`, 'Edit a Daily')

    expect(await screen.findByText('Preparing your Dailies')).toBeInTheDocument()
    expect(screen.getByText('Preparing…')).toBeInTheDocument()

    server.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Title')).toHaveValue('Calibrate sensors')
  })

  it('shows an unavailable state on load failure and recovers on Retry', async () => {
    const user = userEvent.setup()
    server.server.use(
      http.get('/api/daily/dailies/:id', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Load exploded.' } },
          { status: 500 },
        ),
      ),
    )
    await renderAt(`/dailies/${FIXED_DAILY_IDS.calibrate}/edit`, 'Edit a Daily')
    expect(
      await screen.findByRole('heading', { name: 'The Daily could not be loaded' }),
    ).toBeInTheDocument()

    server.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText('Title')).toHaveValue('Calibrate sensors')
  })
})
