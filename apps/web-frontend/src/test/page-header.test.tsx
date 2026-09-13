import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageHeader } from '@/shared/ui/PageHeader'

describe('PageHeader', () => {
  it('renders a single h1 and an optional description', () => {
    render(<PageHeader title="Dailies" description="Today's responsibilities." />)

    expect(screen.getByRole('heading', { level: 1, name: 'Dailies' })).toBeInTheDocument()
    expect(screen.getByText("Today's responsibilities.")).toBeInTheDocument()
  })

  it('omits the description paragraph when none is provided', () => {
    render(<PageHeader title="Ship" />)

    expect(screen.getByRole('heading', { level: 1, name: 'Ship' })).toBeInTheDocument()
    expect(screen.queryByText(/./, { selector: 'p' })).not.toBeInTheDocument()
  })
})
