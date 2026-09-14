import { expect, test } from '@playwright/test'

type MockRuntime = {
  readonly scenario: string
}

declare global {
  interface Window {
    __galaxifyMock?: MockRuntime
  }
}

test.describe('mock mode (MSW)', () => {
  test('serves the default scenario over relative /api paths and fails unhandled requests', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await page.waitForFunction(() => window.__galaxifyMock !== undefined)

    const health = await page.evaluate(async () => {
      const response = await fetch('/api/user/health')
      return { status: response.status, body: (await response.json()) as unknown }
    })
    expect(health.status).toBe(200)
    expect(health.body).toEqual({ status: 'ok', service: 'user-service' })

    const scenario = await page.evaluate(() => window.__galaxifyMock?.scenario)
    expect(scenario).toBe('established-player')

    const unhandledStatus = await page.evaluate(async () => {
      const response = await fetch('/api/mystery/route')
      return response.status
    })
    expect(unhandledStatus).toBe(501)
  })
})
