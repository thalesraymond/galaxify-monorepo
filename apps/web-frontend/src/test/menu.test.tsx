import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Menu } from '@/shared/ui'

function renderAccountMenu() {
  return render(
    <Menu label="Account">
      <button role="menuitem" type="button">
        Profile
      </button>
      <button role="menuitem" type="button">
        Log out
      </button>
    </Menu>,
  )
}

describe('Menu composite widget', () => {
  it('opens on click and moves focus to the first item', async () => {
    const user = userEvent.setup()
    renderAccountMenu()

    await user.click(screen.getByRole('button', { name: 'Account' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus()
  })

  it('opens on ArrowDown to the first item and ArrowUp to the last item', async () => {
    const user = userEvent.setup()
    renderAccountMenu()
    const trigger = screen.getByRole('button', { name: 'Account' })

    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus()

    await user.keyboard('{Escape}')
    trigger.focus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus()
  })

  it('cycles with arrow keys and jumps with Home/End', async () => {
    const user = userEvent.setup()
    renderAccountMenu()

    await user.click(screen.getByRole('button', { name: 'Account' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toHaveFocus()
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    renderAccountMenu()
    const trigger = screen.getByRole('button', { name: 'Account' })

    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
