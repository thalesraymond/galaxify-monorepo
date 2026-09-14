import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  ConfirmationDialog,
  EmptyState,
  Field,
  Gauge,
  Skeleton,
  StatusBadge,
  UnavailableState,
} from '@/shared/ui'

describe('shared UI primitives', () => {
  it('connects visible field labels and validation errors', () => {
    render(<Field label="Email" error="Enter a valid email address." />)

    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a valid email address.')
  })

  it('gives same-label fields distinct ids derived from useId', () => {
    render(
      <>
        <Field label="Email" />
        <Field label="Email" />
      </>,
    )

    const inputs = screen.getAllByLabelText('Email')
    expect(inputs).toHaveLength(2)
    const [first, second] = inputs
    expect(first?.id).toBeTruthy()
    expect(second?.id).toBeTruthy()
    expect(first?.id).not.toBe(second?.id)
  })

  it('exposes a gauge with a textual value', () => {
    render(<Gauge label="Hull condition" value={62} />)

    expect(screen.getByRole('progressbar', { name: 'Hull condition' })).toHaveAttribute(
      'aria-valuenow',
      '62',
    )
    expect(screen.getByText('62 / 100')).toBeInTheDocument()
  })

  it('provides labeled loading, empty, and unavailable states', () => {
    const onRetry = () => undefined
    render(
      <>
        <Skeleton />
        <EmptyState title="No Dailies">Create a Daily to start your logbook.</EmptyState>
        <UnavailableState onRetry={onRetry} />
        <UnavailableState delayed />
        <StatusBadge status="ready" />
        <StatusBadge status="preparing" />
        <StatusBadge status="updating" />
      </>,
    )

    expect(screen.getByRole('status', { name: 'Loading content' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No Dailies' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.getByText('Update delayed')).toBeInTheDocument()
  })

  it('traps focus and restores it after a confirmation dialog closes', async () => {
    const user = userEvent.setup()
    const trigger = document.createElement('button')
    trigger.textContent = 'Delete Daily'
    document.body.append(trigger)
    trigger.focus()
    function DialogExample() {
      const [open, setOpen] = useState(true)
      return open ? (
        <ConfirmationDialog
          title="Delete Daily"
          onCancel={() => {
            setOpen(false)
          }}
          onConfirm={() => undefined}
        >
          <p>This cannot be undone.</p>
        </ConfirmationDialog>
      ) : null
    }

    render(<DialogExample />)

    const dialog = screen.getByRole('dialog', { name: 'Delete Daily' })
    expect(dialog).toBeInTheDocument()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})
