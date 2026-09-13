import { QueryClient } from '@tanstack/react-query'

/**
 * Creates the single application QueryClient. Server state is owned by
 * TanStack Query; never copied into React Context or a global store
 * (`docs/specs/web-frontend.md` §3.1).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}
