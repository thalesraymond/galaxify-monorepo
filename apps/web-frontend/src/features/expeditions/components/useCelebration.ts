import { useEffect, useState } from 'react'

const CELEBRATION_START_MS = 0
const CELEBRATION_DURATION_MS = 450

/**
 * Returns `true` for a short window when `newlyObserved` flips on, so a
 * restrained 300–500 ms celebration plays exactly once for a result observed in
 * the current page session and never replays on revisit (`DESIGN.md` §Motion).
 */
export function useCelebration(newlyObserved: boolean): boolean {
  const [celebrating, setCelebrating] = useState(false)

  useEffect(() => {
    if (!newlyObserved) {
      return
    }
    const startHandle = window.setTimeout(() => {
      setCelebrating(true)
    }, CELEBRATION_START_MS)
    const endHandle = window.setTimeout(() => {
      setCelebrating(false)
    }, CELEBRATION_DURATION_MS)
    return () => {
      window.clearTimeout(startHandle)
      window.clearTimeout(endHandle)
    }
  }, [newlyObserved])

  return celebrating
}
