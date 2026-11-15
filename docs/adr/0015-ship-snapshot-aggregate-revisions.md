# ADR-0015: Order Ship Snapshots by Aggregate Revision

- **Status:** Accepted; approved contract, not implemented
- **Date:** 2026-11-15
- **Source:** Maintainer decisions during triage of [#324](https://github.com/thalesraymond/galaxify-monorepo/issues/324)
- **Extends:** ADR-0005 event contracts and ADR-0010 idempotent consumers

## Context

Expedition consumes full `ship.status_updated` snapshots into its local Ship
projection. Event-ID deduplication prevents repeated processing of the same
event, but does not order different events. The current cache upsert replaces
hull and materials unconditionally. A controlled PostgreSQL reproduction
applied a newer snapshot with hull 90 and materials 50, then an older snapshot
with hull 70 and materials 20. The final cache contained 70 and 20.

The current event has a schema version but no aggregate revision. Timestamps
and event IDs cannot establish the authoritative order of Ship writes.
Existing caches may already be stale, and assigning revisions to their
contents would not repair them.

## Decision

### Ship revision and atomic publication

A Ship revision orders committed state writes for one Player's Ship, not
events across Players. Store it as a nonnegative PostgreSQL `BIGINT` and use
`int64` in Go. Revision exhaustion must fail the write rather than wrap.

Every successful update of an existing Ship row increments its revision
atomically in the same database write. Stage the resulting full Ship snapshot
in the transactional outbox in that same transaction. This includes Daily
rewards, missed-Daily damage, Expedition spending, successful Expedition
rewards, and repair. A successful update still advances the revision when
clamping or zero amounts leave values unchanged. Rejected operations,
rolled-back transactions, and deduplicated deliveries do not advance it.
An operation that performs no Ship update emits no snapshot.

Concurrent updates of the same Ship must receive distinct increasing
revisions paired with their actual resulting state. The increment must not
be calculated from an unlocked application-level read.

### Versioned snapshot contract

New `ShipStatusUpdated` payloads use schema `version: 2` and include
`revision`, a required positive signed 64-bit integer, alongside `user_id`,
`hull_health`, and `materials_balance`. The envelope version remains unchanged.
Schema version, aggregate revision, event ID, and timestamps have separate
meanings; none substitutes for another.

After cutover, legacy payload version 1 snapshots are acknowledged without
changing the projection. They cannot be ordered safely. Version 2 snapshots
must pass existing identity/state validation and revision validation before
application. Missing, zero, negative, non-integral, or out-of-range version 2
revisions, and unsupported payload versions, follow the existing
error/dead-letter path without changing the cache. Ignoring a legacy snapshot
is not permission to acknowledge malformed envelopes.

For valid version 2 snapshots, Expedition inserts a missing cache row or
atomically updates an existing row only if the incoming revision is strictly
greater than its stored revision. Lower and equal revisions are successful
no-ops, even if an equal-revision payload has different state. Such no-ops
leave hull, materials, revision, and `updated_at` unchanged and commit
event-ID deduplication normally. They must not become query "no rows"
errors, retries, or dead letters.

### New-Player provisioning

Preserve the existing independent `user.created` bootstrap: Ship and
Expedition seed hull 100 and materials 0 at revision 0. Initial Ship
provisioning still emits no snapshot. The first later successful Ship update
advances to revision 1. Cache seeding remains insert-if-absent so delayed
`user.created` delivery cannot overwrite an applied snapshot. A version 2
snapshot may arrive first and create the cache row.

### Existing-data backfill and maintenance cutover

A coordinated maintenance cutover is accepted; zero-downtime mixed-version
operation is not required. Preserve Ship state, existing cache values, outbox
rows, and queued events. Do not purge queues, reset balances, or relabel
unversioned snapshots as authoritative.

1. Block incoming state-changing HTTP operations and pause all Ship writers,
   including its domain-event consumers. Let in-progress transactions finish
   and stop old application instances before schema/data conversion. Keep
   Expedition launches unavailable throughout baseline synchronization.
2. Add revision storage. Existing cache rows begin at revision 0; their
   retained values are not an authoritative baseline.
3. For each existing Ship, atomically establish revision 1 and stage a
   matching version 2 baseline snapshot in its own outbox. Backfill comes
   from the authoritative Ship row, never from the projection. Make the
   operation resumable: a failure rolls back the revision and outbox write
   together; rerunning skips already-backfilled Ships without resetting
   revisions or creating another baseline. Transport redelivery of the same
   staged event remains allowed.
4. A one-off operator maintenance command explicitly drains Ship's outbox
   through the existing shared publisher/drainer while normal Ship writers
   remain paused. Run the upgraded Expedition snapshot consumer to apply
   baselines and ignore legacy snapshots. Preserve other queued domain
   events for normal processing after cutover. No scheduled-relay issue
   is a prerequisite.
5. With Ship writers still paused, verify every existing Ship has its
   baseline applied in Expedition with matching revision, hull, and
   materials. Missing or mismatched rows block reopening; an empty pending
   outbox alone is not proof of projection convergence. Surface cache rows
   without an authoritative Ship for investigation rather than treating
   their revision 0 state as verified.
6. Resume only upgraded writers and normal traffic after verification.
   Queued domain events such as Daily rewards then mutate authoritative
   Ships normally and emit newer version 2 snapshots.

Publication or verification failure leaves the system in maintenance.
The command must be bounded/cancellable, report failure or incomplete work,
and support safe retry. Reuse transactional outbox publication and preserve
staged event identities; do not bypass the outbox or invent a second
publisher. A safe dry-run/preflight must not mutate data. The documented
operator procedure must make write-pause prerequisites and verification
steps explicit. Implementing this command does not authorize running it
against a shared or production system.

Once version 2 publication is enabled, recover by fixing forward. Restarting
old writers or downgrading to revision-blind consumers is not a supported
rollback. The implementation must cover schema migrations and the Expedition
worker's mirrored schema as well as service code.

## Alternatives Considered

- **Event-ID deduplication alone:** cannot reject an older distinct event.
- **Wall-clock timestamps:** cannot establish atomic aggregate write order.
- **Accept legacy snapshots until the first version 2 event:** can regress
  uninitialized projections and does not repair an already-stale cache.
- **Assign revisions to existing cache contents:** certifies potentially
  stale state rather than rebuilding it from the owner.
- **Zero-downtime mixed-version rollout:** adds compatibility machinery not
  justified for this bounded change; a coordinated maintenance cutover was
  approved instead.

## Consequences

This prevents projection regression under reordering, duplicates, and
concurrent snapshot delivery. It does not make delivery immediate or make
Expedition funding authoritative. A projection may still lag the Ship owner.

The accepted cost is a maintenance window with explicit baseline publication
and verification. The general scheduled outbox relay, retry redesign, DLQ
replay tooling, funding serialization, frontend changes, and HTTP response
changes remain out of scope.

Implementation must prove reverse-order and equal-revision no-ops against
real PostgreSQL; atomic concurrent revision increments and mutation/outbox
rollback; legacy and invalid-payload behavior; new-Player delivery orders;
and backfill restart/publication/verification failure behavior. A fake that
merely records SQL calls is insufficient evidence for ordering or atomicity.
