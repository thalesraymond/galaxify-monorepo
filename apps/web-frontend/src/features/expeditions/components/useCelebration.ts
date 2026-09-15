import { useEffect, useState } from 'react'

/**
 * Duration of the restrained result celebration, in ms. Must match
 * `--celebration-duration` in `expeditionPanels.module.css` — the CSS property
 * is the visual source of truth and this constant drives the hook's window so
 * the animated class is removed at the same moment the animation ends.
 */
export const CELEBRATION_DURATION_MS = 450

const CELEBRATION_START_MS = 0

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
