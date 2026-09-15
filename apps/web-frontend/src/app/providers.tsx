import { useState } from 'react'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'

import { SessionProvider, type SessionRuntime } from '@/features/auth'
import { createQueryClient } from './queryClient'

type AppRouter = Parameters<typeof RouterProvider>[0]['router']

export type AppProvidersProps = {
  /** Router supplied by the entry point (browser) or a test (memory). */
  router: AppRouter
  /** Optional session runtime so tests can inject fakes. */
  sessionRuntime?: SessionRuntime | undefined
}

/**
 * Stable app-wide dependencies. React Context is limited to long-lived
 * infrastructure like the query client and session access; server state is
 * never mirrored here.
 */
export function AppProviders({ router, sessionRuntime }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider runtime={sessionRuntime}>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>
  )
}
