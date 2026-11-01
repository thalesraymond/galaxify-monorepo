import { expect, type Page } from '@playwright/test'

import { seedAuthenticated } from './session'

/** The real route and Retry, with only the service's delayed result controlled. */
export async function expectResultObservationSurvivesNavigation(page: Page): Promise<void> {
  await seedAuthenticated(page)
  await page.goto('/expeditions/history')
  await expect(page.getByRole('heading', { name: 'Expedition history' })).toBeVisible()
  await page.evaluate(() => {
    const runtime = window.__galaxifyMock
    if (runtime === undefined) throw new Error('Mock runtime is unavailable')
    const { backend } = runtime
    const getExpedition = backend.getExpedition.bind(backend)
    let available = false
    window.addEventListener('test:result-available', () => {
      available = true
    })
    backend.getExpedition = (token, id) => {
      const resolved = getExpedition(token, id)
      if (available) return resolved
      const missing = { ...resolved }
      delete missing.result
      return missing
    }
  })
  await page.getByRole('link', { name: /Success/ }).click()
  await expect(page.getByText('Confirming your result')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Confirming your result' })).toContainText(
    'Updating…',
  )
  await expect(page.getByText('Update delayed')).toBeVisible({ timeout: 12_000 })

  await page.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Expedition history' })).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Update delayed')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('test:result-available')))
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Expedition resolved' })).toBeVisible()
  await expect(page.getByText('+80 materials', { exact: true })).toBeVisible()
  await expect(page.getByText('Update delayed')).toHaveCount(0)
}
