import { defineConfig, devices } from '@playwright/test'

const PREVIEW_PORT = 4173
const MOCK_PORT = 4174
const baseURL = `http://127.0.0.1:${PREVIEW_PORT}`
const mockBaseURL = `http://127.0.0.1:${MOCK_PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
    },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL },
      testIgnore: /mock-smoke\.spec\.ts/,
    },
    {
      name: 'mock-chromium',
      use: { ...devices['Desktop Chrome'], baseURL: mockBaseURL },
      testMatch: /mock-smoke\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: `npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Deterministic MSW-backed dev server; defaults to `established-player`.
      command: `npm run dev:mock -- --host 127.0.0.1 --port ${MOCK_PORT} --strictPort`,
      url: mockBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
