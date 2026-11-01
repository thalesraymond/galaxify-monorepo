import { expect, test } from '@playwright/test'

import type { Expedition } from '../src/api/generated/expedition/types.gen'
import type { Ship } from '../src/api/generated/ship/types.gen'
import { seedAuthenticated } from './session'

test('a resolved reward continues observing on the Ship page', async ({ page }) => {
  await seedAuthenticated(page)
  await page.goto('/dashboard')
  await expect(page.getByRole('heading', { name: 'Ship status' })).toBeVisible()
  await page.evaluate(() => {
    const { backend } = window.__galaxifyMock as unknown as {
      backend: {
        getShip: (token: string | undefined) => Ship
        getExpedition: (token: string | undefined, id: string) => Expedition
      }
    }
    const getShip = backend.getShip.bind(backend)
    const getExpedition = backend.getExpedition.bind(backend)
    let applied = false
    window.addEventListener('test:reward-applied', () => {
      applied = true
    })
    backend.getShip = (token) => ({ ...getShip(token), materials_balance: applied ? 330 : 250 })
    backend.getExpedition = (token, id) => {
      const expedition = getExpedition(token, id)
      return expedition.result === undefined
        ? expedition
        : {
            ...expedition,
            result: { ...expedition.result, created_at: '2027-01-01T00:00:00Z' },
          }
    }
  })
  await page.getByRole('link', { name: 'View history' }).click()
  await page.getByRole('link', { name: /Success/ }).click()
  await expect(page.getByText('+80 materials', { exact: true })).toBeVisible()
  await expect(page.getByText('Updating…')).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'Ship' })
    .click()
  await expect(page.getByText('Updating…')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('test:reward-applied')))
  await expect(page.getByRole('region', { name: 'Materials' }).getByText('330')).toBeVisible({
    timeout: 6_000,
  })
  await expect(page.getByText('Updating…')).toHaveCount(0)
})
