/**
 * Runs Lighthouse CI against the built preview server using the Chromium that
 * Playwright installs. Falls back to the ambient Chrome when Playwright's
 * browser has not been downloaded (for example in a restricted sandbox).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { chromium } from '@playwright/test'

function resolveChromePath() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH
  }

  try {
    const candidate = chromium.executablePath()
    return existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

const chromePath = resolveChromePath()
if (chromePath) {
  process.env.CHROME_PATH = chromePath
  console.log(`Using Chromium at ${chromePath}`)
} else {
  console.warn('No Chromium path resolved; Lighthouse will look for a system Chrome.')
}

const result = spawnSync('npx', ['lhci', 'autorun'], {
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
