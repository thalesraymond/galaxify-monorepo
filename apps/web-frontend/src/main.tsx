import '@/shared/styles/tokens.css'

import { resolveRootContainer } from '@/app/dom'
import { mountApp } from '@/app/mount'

async function bootstrap(): Promise<void> {
  // Mock mode is a build-time branch: production bundles never include MSW.
  if (import.meta.env.MODE === 'mock') {
    const { startMockDevelopmentServer } = await import('@/mocks/browser')
    await startMockDevelopmentServer()
  }
  mountApp(resolveRootContainer())
}

void bootstrap()
