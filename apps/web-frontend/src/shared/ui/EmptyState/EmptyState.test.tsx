import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it.each([false, true])('preserves the next action when embedded=%s', (embedded) => {
    render(
      <EmptyState
        title="No Dailies"
        embedded={embedded}
        action={<a href="/dailies/new">Create Daily</a>}
      >
        Create a recurring responsibility.
      </EmptyState>,
    )
    expect(screen.getByRole('heading', { name: 'No Dailies' })).toBeVisible()
    expect(screen.getByText('Create a recurring responsibility.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Create Daily' })).toHaveAttribute(
      'href',
      '/dailies/new',
    )
  })
})
