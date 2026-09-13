import { useState } from 'react'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'

import { createQueryClient } from './queryClient'

type AppRouter = Parameters<typeof RouterProvider>[0]['router']

export type AppProvidersProps = {
  /** Router supplied by the entry point (browser) or a test (memory). */
  router: AppRouter
}

/**
 * Stable app-wide dependencies. React Context is limited to long-lived
 * infrastructure like the query client; server state is never mirrored here.
 */
export function AppProviders({ router }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
