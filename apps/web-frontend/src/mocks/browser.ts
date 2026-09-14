import { setupWorker } from 'msw/browser'

import { FIXED_MOCK_EPOCH_MS } from './fixtures'
import { createMockHandlers, onUnhandledMockRequest } from './handlers'
import { MockBackend } from './backend'
import { SystemMockScheduler } from './clock'
import { defaultMockScenario, parseMockScenario, type MockScenarioName } from './scenarios'
import { LocalStorageMockStateStore } from './state'

/**
 * Browser-only MSW bootstrap for `npm run dev:mock`. Real mode never imports
 * this module's worker, so the mock runtime stays out of the real stack and the
 * production bundle.
 */
export function isMockDevelopmentMode(): boolean {
  return import.meta.env.MODE === 'mock'
}

export type MockDevelopmentRuntime = {
  readonly backend: MockBackend
  readonly scenario: MockScenarioName
  reset(scenario?: MockScenarioName): void
}

let runtime: MockDevelopmentRuntime | undefined

export async function startMockDevelopmentServer(): Promise<void> {
  if (!isMockDevelopmentMode() || runtime !== undefined) {
    return
  }

  const scenario = parseMockScenario(import.meta.env.VITE_MOCK_SCENARIO)
  const store = new LocalStorageMockStateStore()
  const backend = new MockBackend({
    scenario,
    scheduler: new SystemMockScheduler(FIXED_MOCK_EPOCH_MS),
    store,
  })
  const worker = setupWorker(...createMockHandlers(backend))
  await worker.start({
    onUnhandledRequest: onUnhandledMockRequest,
    serviceWorker: { url: '/mockServiceWorker.js' },
  })

  runtime = {
    backend,
    scenario,
    reset(next: MockScenarioName = defaultMockScenario) {
      backend.reset(next)
    },
  }

  // Development/test-only reset control. Never player-facing UI.
  Object.defineProperty(window, '__galaxifyMock', {
    configurable: true,
    value: runtime,
  })
}

export function getMockDevelopmentRuntime(): MockDevelopmentRuntime | undefined {
  return runtime
}

declare global {
  interface Window {
    __galaxifyMock?: MockDevelopmentRuntime
  }
}
