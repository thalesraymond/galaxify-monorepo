import { setupServer } from 'msw/node'

import { MockBackend, type MockBackendOptions } from './backend'
import { createMockHandlers, onUnhandledMockRequest } from './handlers'
import { InMemoryMockStateStore } from './state'

export type MockTestServer = {
  readonly backend: MockBackend
  readonly server: ReturnType<typeof setupServer>
  /** Clears in-memory state back to the scenario's deterministic baseline. */
  reset(scenario?: MockBackendOptions['scenario']): void
  /** Stops request interception and releases MSW listeners. */
  stop(): void
}

/**
 * Shared test server built from the same handlers and fixture/state model as
 * the browser worker (issue #136 resolution). Tests get an isolated in-memory
 * store with the response delay disabled by default.
 */
export function createMockTestServer(
  options: Omit<MockBackendOptions, 'store' | 'responseDelayMs'> & { responseDelayMs?: number },
): MockTestServer {
  const backend = new MockBackend({
    ...options,
    store: new InMemoryMockStateStore(),
    responseDelayMs: options.responseDelayMs ?? 0,
  })
  const server = setupServer(...createMockHandlers(backend))

  return {
    backend,
    server,
    reset(scenario = backend.getScenario()) {
      backend.reset(scenario)
    },
    stop() {
      server.close()
    },
  }
}

export { onUnhandledMockRequest }
