import { defineConfig, devices } from '@playwright/test'

const MOCK_PORT = 4174
const mockBaseURL = `http://127.0.0.1:${MOCK_PORT}`
const OUTAGE_PORT = 4175
const outageBaseURL = `http://127.0.0.1:${OUTAGE_PORT}`

/**
 * Phase 1 is mock-backed: the deterministic MSW server is the only backend
 * available to E2E, and authenticated routes require a real session token.
 * `npm run preview` + Lighthouse still exercise the production build, and the
 * dedicated outage server covers the temporarily-unavailable session state.
 */
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
    baseURL: mockBaseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL: mockBaseURL },
      testIgnore: /session-outage\.spec\.ts/,
    },
    {
      name: 'outage-chromium',
      use: { ...devices['Desktop Chrome'], baseURL: outageBaseURL },
      testMatch: /session-outage\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // Deterministic MSW-backed dev server; defaults to `established-player`.
      command: `npm run dev:mock -- --host 127.0.0.1 --port ${MOCK_PORT} --strictPort`,
      url: mockBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `VITE_MOCK_SCENARIO=service-outage npm run dev:mock -- --host 127.0.0.1 --port ${OUTAGE_PORT} --strictPort`,
      url: outageBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
