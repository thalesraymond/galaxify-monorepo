import { useEffect, useRef, useState } from 'react'

export type BoundedProbePhase = 'idle' | 'updating' | 'delayed'

/** Step size for the visible-time accumulator; small so pauses resume precisely. */
const PROBE_STEP_MS = 100

/** §3.4: reconcile immediately and after approximately 1, 2, 4, and 8 seconds. */
const PROBE_MARKS_MS = [1_000, 2_000, 4_000, 8_000] as const

function isVisibleAndOnline(): boolean {
  return document.visibilityState === 'visible' && navigator.onLine
}

function schedulerDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

/**
 * Bounded downstream reconciliation schedule (§3.4): probes immediately, then
 * at approximately 1, 2, 4, and 8 seconds cumulative from the command, and
 * stops as soon as `probe` reports satisfaction. The 1/2/4/8s budget only
 * accumulates while the tab is visible and online — a hidden or offline period
 * PAUSES the schedule without consuming the budget or expiring to `delayed`
 * (§3.2). Completion leaves `idle`; exhaustion leaves `delayed` with a
 * player-initiated `retry`. Never replays a command.
 */
export function useBoundedProbe({
  enabled,
  probe,
}: {
  enabled: boolean
  probe: () => Promise<boolean>
}): { phase: BoundedProbePhase; retry: () => void } {
  const [phase, setPhase] = useState<BoundedProbePhase>('idle')
  const [attempt, setAttempt] = useState(0)
  const probeRef = useRef(probe)

  useEffect(() => {
    probeRef.current = probe
  })

  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false

    const attemptProbe = async (): Promise<boolean> => {
      try {
        const satisfied = await probeRef.current()
        if (!cancelled && satisfied) {
          setPhase('idle')
          return true
        }
        return satisfied
      } catch {
        // A failing probe is unsatisfied; the schedule keeps bounded retries.
        return cancelled
      }
    }

    const run = async (): Promise<void> => {
      setPhase('updating')
      // Immediate probe (the command's own confirmation), then the marks.
      if (await attemptProbe()) {
        return
      }
      let visibleElapsedMs = 0
      for (const mark of PROBE_MARKS_MS) {
        while (visibleElapsedMs < mark) {
          await schedulerDelay(PROBE_STEP_MS)
          if (cancelled) {
            return
          }
          if (isVisibleAndOnline()) {
            visibleElapsedMs += PROBE_STEP_MS
          }
        }
        if (await attemptProbe()) {
          return
        }
      }
      if (!cancelled) {
        setPhase('delayed')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [enabled, attempt])

  const effectivePhase: BoundedProbePhase = enabled ? phase : 'idle'

  return {
    phase: effectivePhase,
    retry: () => {
      setAttempt((value) => value + 1)
    },
  }
}
