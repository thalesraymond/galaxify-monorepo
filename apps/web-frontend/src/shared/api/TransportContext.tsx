import { createContext, useContext, type ReactNode } from 'react'

import type { ApiTransport } from '@/api/transport'

/**
 * Stable app-wide dependency holding the session-aware transport. React Context
 * is limited to long-lived infrastructure and session access
 * (`docs/specs/web-frontend.md` §3.1); server state stays in TanStack Query.
 */
const ApiTransportContext = createContext<ApiTransport | undefined>(undefined)

export function TransportProvider({
  transport,
  children,
}: {
  transport: ApiTransport
  children: ReactNode
}) {
  return <ApiTransportContext.Provider value={transport}>{children}</ApiTransportContext.Provider>
}

export function useApiTransport(): ApiTransport {
  const transport = useContext(ApiTransportContext)
  if (transport === undefined) {
    throw new Error('useApiTransport must be used within a TransportProvider.')
  }
  return transport
}
