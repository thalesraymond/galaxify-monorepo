---
type: problem
created: 2026-11-01
updated: 2026-11-01
sources:
  - "Review of issue #223, 2026-11-01"
---

# A module-level subscription never pauses a pending observation

## Symptom

A domain adapter of the shared Downstream Reconciliation module
(`apps/web-frontend/src/shared/reconciliation/`) keeps its own store in sync
with a round's phase by subscribing once, at module scope, for every
expectation. The round then never pauses: it keeps reading the downstream
resource long after the Player navigated away from the view that displays it,
and the "pause while no view displays the affected resource" rule of
`docs/specs/web-frontend.md` §3.2 silently does not apply.

The symptom is invisible in the adapter's own tests (the reads they expect do
happen) and shows up as "the Ship balance keeps refreshing after I left the
page".

## Cause

The shared module counts *visible observers* — `subscribe(key, listener)` — as
the only thing that keeps reads running (`hasObserver`). A subscription that
only wants to follow the phase is still a visible observer, so
`hasObserver(key)` is permanently true and the round never pauses. A session
store that lives for the Player session must not pretend to be a view.

## Fix

- The shared module has a phase-only seam: `subscribeToPhase(key, listener)`
  follows a round's phase but never counts as a visible observer and never
  wakes a paused round. `notify` informs visible observers and phase
  listeners; `hasObserver` counts visible observers only.
- A domain adapter follows phases with `subscribeToPhase` and registers the
  visible observer in the view that displays the affected resource (for the
  Daily award: `DailyRow`, active while it renders a reconciliation).
- A test that renders only a hook must play the observer role itself, or the
  bounded schedule never runs and the test fails for the wrong reason.

Related: [fake timers freeze bounded observations](fake-timers-freeze-bounded-observations.md)
— the same module, the other way a bounded schedule silently stops.
