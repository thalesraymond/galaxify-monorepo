import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'

import { EditDailyPage } from '@/features/dailies'
import { ExpeditionDetailPage } from '@/features/expeditions'

function renderStandalone(element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('domain recovery placeholders', () => {
  it('describes a missing Daily id without redirecting', () => {
    renderStandalone(<EditDailyPage />)

    expect(screen.getByText(/id unknown/)).toBeInTheDocument()
  })

  it('recovers a missing Expedition id inside the shell without redirecting', () => {
    renderStandalone(<ExpeditionDetailPage />)

    expect(screen.getByRole('heading', { name: 'Expedition not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Expeditions' })).toHaveAttribute(
      'href',
      '/expeditions',
    )
  })
})
