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

  it('describes a missing Expedition id without redirecting', () => {
    renderStandalone(<ExpeditionDetailPage />)

    expect(screen.getByText(/Expedition unknown/)).toBeInTheDocument()
  })
})
