import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'
import chromeLauncher from 'chrome-launcher'
import lighthouse from 'lighthouse'

const previewPort = 4176
const baseUrl = `http://127.0.0.1:${previewPort}`
const profileDirectory = resolve('.lighthouseci/dashboard-profile')
const performanceFloor = 0.9
const accessibilityFloor = 0.95

if (!existsSync(resolve('dist/index.html'))) {
  throw new Error('No production build found. Run `npm run build` first.')
}

const preview = spawn(
  'npm',
  ['run', 'preview', '--', '--port', String(previewPort), '--strictPort'],
  {
    stdio: 'ignore',
  },
)

try {
  await waitForPreview()
  await seedDashboardSession()
  const scores = await collectDashboardScores()
  assertScores(scores)
} finally {
  preview.kill()
}

async function waitForPreview() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const isReady = await fetch(baseUrl).then(
      (response) => response.ok,
      () => false,
    )
    if (isReady) {
      return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
  }
  throw new Error(`Preview server never became reachable at ${baseUrl}`)
}

async function seedDashboardSession() {
  rmSync(profileDirectory, { recursive: true, force: true })
  const context = await chromium.launchPersistentContext(profileDirectory, { headless: true })
  try {
    const page = await context.newPage()
    await page.goto(`${baseUrl}/signup`)
    await page.getByLabel('Email').fill(`lighthouse-${Date.now()}@galaxify.test`)
    await page.getByLabel('Username').fill(`lh_${Date.now().toString(36)}`)
    await page.getByLabel('Password').fill('password123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.getByRole('heading', { level: 1, name: 'Dashboard' }).waitFor({ timeout: 30_000 })
  } finally {
    await context.close()
  }
}

async function collectDashboardScores() {
  const chrome = await chromeLauncher.launch({
    chromePath: chromium.executablePath(),
    chromeFlags: [
      '--headless',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${profileDirectory}`,
    ],
  })
  try {
    const result = await lighthouse(`${baseUrl}/dashboard`, {
      port: chrome.port,
      output: 'json',
      onlyCategories: ['performance', 'accessibility'],
    })
    if (result === undefined || result.lhr === undefined) {
      throw new Error('Lighthouse produced no report')
    }
    mkdirSync(resolve('.lighthouseci'), { recursive: true })
    writeFileSync(resolve('.lighthouseci/dashboard-lhr.json'), result.report)
    return {
      performance: result.lhr.categories.performance.score ?? 0,
      accessibility: result.lhr.categories.accessibility.score ?? 0,
    }
  } finally {
    await chrome.kill()
  }
}

function assertScores(scores) {
  console.log(
    `Dashboard Lighthouse: performance ${scores.performance}, accessibility ${scores.accessibility}`,
  )
  const failures = []
  if (scores.performance < performanceFloor) {
    failures.push(`performance ${scores.performance} < ${performanceFloor}`)
  }
  if (accessibilityFloor > scores.accessibility) {
    failures.push(`accessibility ${scores.accessibility} < ${accessibilityFloor}`)
  }
  if (failures.length > 0) {
    throw new Error(`Dashboard Lighthouse floors not met: ${failures.join('; ')}`)
  }
}
