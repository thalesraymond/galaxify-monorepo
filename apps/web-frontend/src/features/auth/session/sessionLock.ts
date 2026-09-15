/** Named Web Lock serializing single-use refresh rotation across tabs. */
export const SESSION_REFRESH_LOCK = 'galaxify.session.refresh'

export interface SessionLock {
  run<T>(name: string, task: () => Promise<T>): Promise<T>
}

/**
 * Web Locks-backed serialization. Environments without the Web Locks API fall
 * back to running the task directly; the typed storage re-read inside the task
 * still makes rotation safe within a single tab.
 */
export class WebLockSessionLock implements SessionLock {
  public async run<T>(name: string, task: () => Promise<T>): Promise<T> {
    const navigatorWithLocks = globalThis.navigator as { readonly locks?: LockManager } | undefined
    const locks = navigatorWithLocks?.locks
    if (locks === undefined) {
      return await task()
    }
    return await locks.request(name, task)
  }
}
