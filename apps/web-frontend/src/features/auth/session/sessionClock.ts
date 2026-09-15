/**
 * Injectable clock/visibility/activity source for the session lifecycle.
 * Production uses wall-clock time and the real document/window; tests inject a
 * manual clock so scheduled and idle behavior is deterministic
 * (`web-frontend.md` §4.2).
 */
export interface SessionClock {
  now(): number
  schedule(delayMs: number, task: () => void): () => void
  isVisible(): boolean
  subscribeVisibility(listener: (visible: boolean) => void): () => void
  subscribeActivity(listener: () => void): () => void
}

export class BrowserSessionClock implements SessionClock {
  public now(): number {
    return Date.now()
  }

  public schedule(delayMs: number, task: () => void): () => void {
    const handle = setTimeout(task, delayMs)
    return () => {
      clearTimeout(handle)
    }
  }

  public isVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState === 'visible'
  }

  public subscribeVisibility(listener: (visible: boolean) => void): () => void {
    if (typeof document === 'undefined') {
      return () => {}
    }
    const handle = (): void => {
      listener(this.isVisible())
    }
    document.addEventListener('visibilitychange', handle)
    return () => {
      document.removeEventListener('visibilitychange', handle)
    }
  }

  public subscribeActivity(listener: () => void): () => void {
    if (typeof window === 'undefined') {
      return () => {}
    }
    const events = ['pointerdown', 'keydown'] as const
    for (const event of events) {
      window.addEventListener(event, listener)
    }
    return () => {
      for (const event of events) {
        window.removeEventListener(event, listener)
      }
    }
  }
}
