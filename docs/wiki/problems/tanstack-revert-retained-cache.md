---
type: problem
created: 2026-11-01
updated: 2026-11-01
sources:
  - "Issue #228 review, galaxify-monorepo@ca89c95"
  - "PR #268, galaxify-monorepo@268352d"
---

# TanStack Query cancel/revert resolves retained cache

On 2026-11-01, review of issue #228 found that `observeShip` could resolve the
previous `ShipState` when a fetch was cancelled or reverted — removing the last
observer, `cancelQueries`, or a visibility change. Callers then published
retained facts as if they were fresh.

The fix lives at the Ship seam, not in each adapter:

- `getShip` captures the session generation and command revision at read start
  and validates both **before** touching the fetch marker, for ready and
  provisioning responses. A late read after logout or a command publish throws.
- `observeShip` forces a server read even at the same millisecond
  (`staleTime: -1`), captures the fetch marker and command revision, and after
  `queryClient.query` re-checks the command revision plus the marker/last-state
  match. The post-check also covers joined reads whose own `queryFn` never ran.
- `markShipPublished` advances a monotonic command revision and the marker;
  `repairShipAndCache` uses it after publishing the confirmed repair. Session
  clear clears the marker and increments the revision.

Regressions: a held GET cancelled/reverted; an old GET resolving after a repair;
two joined reads with a command publish during the fetch; a retained-cache gate
staying closed; a late read after session clear leaving no Ship state behind.
See [downstream reconciliation](../subsystems/downstream-reconciliation.md) and
[approval generations](reconciliation-approval-generations.md).
