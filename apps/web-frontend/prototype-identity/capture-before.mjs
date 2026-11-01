/* global window */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const browser = await chromium.launch()
const page = await browser.newPage()
if (!process.env.CAPTURE_CURRENT_DATE)
  await page.clock.setFixedTime(new Date('2026-01-15T09:00:00Z'))
await page.goto('http://127.0.0.1:4317/login')
await page.waitForFunction(() => window.__galaxifyMock !== undefined)
await page.evaluate(async () => {
  const response = await fetch('/api/user/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'captain@galaxify.test', password: 'password123' }),
  })
  const body = await response.json()
  localStorage.setItem(
    'galaxify.session.refresh.v1',
    JSON.stringify({ version: 1, refreshToken: body.refresh_token }),
  )
})
await page.goto('http://127.0.0.1:4317/dashboard')
await page.getByRole('heading', { level: 1, name: 'Dashboard' }).waitFor()
const directory = `prototype-identity/evidence/${process.env.CAPTURE_CURRENT_DATE ? 'before-current-date' : 'before'}`
await mkdir(directory, { recursive: true })
for (const width of [1440, 768, 390, 320]) {
  await page.setViewportSize({ width, height: width < 500 ? 844 : 900 })
  await page.screenshot({ path: `${directory}/dashboard-${width}.png`, fullPage: true })
}
await browser.close()
