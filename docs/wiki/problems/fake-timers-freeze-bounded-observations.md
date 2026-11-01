---
type: problem
created: 2026-11-01
updated: 2026-11-01
sources:
  - "OpenCode session implementing issue #223, 2026-11-01"
---

# Fake timers must fake `performance` or bounded observations freeze

## Symptom

A caller migrated onto the shared Downstream Reconciliation module
(`apps/web-frontend/src/shared/reconciliation/`) reads its first fresh fact and
then never advances again: the later schedule marks (1, 2, 4, 8 active seconds)
never fire.

The module measures *active* time with `performance.now()` so a paused round
resumes with its remaining budget. Vitest's default `vi.useFakeTimers()` fakes
`performance`, but the shared helper `apps/web-frontend/src/test/fakeTimers.ts`
deliberately narrows `toFake` (React stalls when `queueMicrotask`/`nextTick`
are faked) and left `performance` out. With a real `performance.now()`, every
100 ms tick measured ~0 ms of elapsed time, so the budget never reached its
first mark.

## Fix

- `enableFakeTimers` fakes `performance` alongside the timers and `Date`.
- Any new helper that fakes timers for a bounded observation must do the same;
  a frozen monotonic clock silently disables the whole schedule.
- A symptom of this bug is "the first read works, the second never happens",
  not a timeout or an error.

Related: the shared module also pauses reads while the tab is hidden or
offline, so a test that hides the document expects *no* fresh read at all
until the tab is visible again.
