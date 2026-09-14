/**
 * Injectable clock/scheduler for deterministic asynchronous mock behavior
 * (issue #136 resolution, "Stateful and asynchronous mock behavior").
 *
 * Production uses wall-clock time via `setTimeout`. Tests use
 * `ManualMockScheduler` to advance provisioning, propagation, and timeout
 * windows instantly instead of sleeping.
 */
export type CancelScheduledTask = () => void

export interface MockScheduler {
  now(): number
  schedule(delayMs: number, task: () => void): CancelScheduledTask
  delay(delayMs: number): Promise<void>
}

/**
 * Wall-clock scheduler used by the browser mock worker. Domain time is anchored
 * to a fixed start (the fixture epoch) plus real elapsed time, so fixtures stay
 * deterministic while delay scheduling still uses `setTimeout`.
 */
export class SystemMockScheduler implements MockScheduler {
  private readonly realStart = Date.now()

  public constructor(private readonly startTime: number = Date.now()) {}

  public now(): number {
    return this.startTime + (Date.now() - this.realStart)
  }

  public schedule(delayMs: number, task: () => void): CancelScheduledTask {
    const handle = setTimeout(task, delayMs)
    return () => {
      clearTimeout(handle)
    }
  }

  public delay(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs)
    })
  }
}

type ScheduledTask = {
  readonly dueAt: number
  readonly task: () => void
  cancelled: boolean
}

/**
 * Deterministic scheduler for tests. `advance(ms)` runs every task whose due
 * time is reached, in due-time then insertion order.
 */
export class ManualMockScheduler implements MockScheduler {
  private currentTime: number
  private readonly tasks: ScheduledTask[] = []

  public constructor(startTime: number) {
    this.currentTime = startTime
  }

  public now(): number {
    return this.currentTime
  }

  public schedule(delayMs: number, task: () => void): CancelScheduledTask {
    const scheduled: ScheduledTask = {
      dueAt: this.currentTime + Math.max(0, delayMs),
      task,
      cancelled: false,
    }
    this.tasks.push(scheduled)
    return () => {
      scheduled.cancelled = true
    }
  }

  public async delay(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
      return
    }
    return new Promise((resolve) => {
      this.schedule(delayMs, resolve)
    })
  }

  /** Runs every pending task whose due time is within `ms` of now. */
  public advance(ms: number): void {
    this.currentTime += Math.max(0, ms)
    this.runDueTasks()
  }

  /** Runs every pending task regardless of its due time. */
  public runAll(): void {
    let next = this.nextPendingTask()
    while (next !== undefined) {
      this.currentTime = Math.max(this.currentTime, next.dueAt)
      next.cancelled = true
      next.task()
      next = this.nextPendingTask()
    }
  }

  private runDueTasks(): void {
    let next = this.nextDueTask()
    while (next !== undefined) {
      next.cancelled = true
      next.task()
      next = this.nextDueTask()
    }
  }

  private nextDueTask(): ScheduledTask | undefined {
    return this.pendingTasks().find((task) => task.dueAt <= this.currentTime)
  }

  private nextPendingTask(): ScheduledTask | undefined {
    return this.pendingTasks()[0]
  }

  private pendingTasks(): ScheduledTask[] {
    return this.tasks
      .filter((task) => !task.cancelled)
      .sort((left, right) => left.dueAt - right.dueAt)
  }
}
