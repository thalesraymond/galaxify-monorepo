# ADR-0016: Scheduled per-database outbox relay jobs

- **Status:** Accepted; approved contract, not implemented
- **Date:** 2026-11-16
- **Source:** Maintainer decisions on [#322](https://github.com/thalesraymond/galaxify-monorepo/issues/322)
- **Supersedes in part:** ADR-0004's HTTP-only triggering decision (takes
  effect when #334 ships); ADR-0004's outbox schema, transaction atomicity,
  and `request_id` correlation remain in force

## Context

The delivered outbox baseline (ADR-0004) drains pending rows only from HTTP
middleware after a request completes, and the `workers/daily-cron` and
`workers/expedition-worker` processes drain only after productive batches.
When no traffic or fresh domain work exists,
committed `PENDING` rows can sit unpublished indefinitely — neither mechanism
provides idle delivery. The deployment target remains Azure Container Apps
(ACA) scale-to-zero on a constrained budget, and the maintainer has decided
not to pay for an always-on relay.

## Decision

### Four per-database ACA scheduled Jobs

Run four independently configured
[Azure Container Apps scheduled Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs),
one per service database (User, Daily, Ship, Expedition), on cron
`* * * * *` UTC with one replica per execution. All four share one
binary/image and the shared relay code; each job's configuration carries only
its own service database credentials and the broker access it needs. There is
no central job holding credentials for all databases, and no persistent
polling inside the applications — API minimum replicas stay at zero.

Jobs run finite batches and finite executions and exit even when the outbox
is empty. An empty tick still queries for existing pending rows; it is not
gated on fresh domain work. The platform may overlap or retry executions, so
scheduling is not exactly-once. Database row locks arbitrate overlap,
including overlap with the legacy HTTP-triggered and worker drains while they
still exist.

### Reuse the shared drain seam

The relay reuses the existing `OutboxBatch`/`OutboxDrainer` publisher seam
(`pkg/events/outbox.go`) and its bounded `FOR UPDATE SKIP LOCKED` batches,
with an initial batch limit of 50 rows. Each batch keeps its transaction and
row locks held through publish acknowledgments, `MarkPublished`, and commit —
there is no early lock-release lease mechanism by default.

The shared drain currently returns void. Under #334, add shared outcome
reporting as needed: logs alone are insufficient to drive bounded retries and
report failure. This ADR does not prescribe an implementation or API
signature.

### Initial operational defaults

These are explicit tunable defaults, not new user-facing promises, and they
have not been benchmarked or deployed:

- 45-second total execution budget per invocation, inclusive of database and
  broker operations, backoff, and cleanup.
- Finite maximum of 20 total attempted batches per invocation, counting every
  attempt including failed ones — not an independent bound on top of the
  retry limit.
- Maximum 3 consecutive failed batch attempts, with exponential full-jitter
  waits capped at 1 then 2 seconds between these attempts. A batch attempt
  counts as failed when any publication in it fails, even if other rows in
  the same batch published successfully — a partial failure is not masked as
  a successful batch. The unpublished rows remain `PENDING` and are not
  discarded.
- All I/O is cancellable and bounded by the remaining budget.
- A fully successful batch resets the consecutive-failure counter but not the
  45-second or 20-batch ceilings. There is no unbounded loop.
- Stop conditions: an empty batch, the budget or batch cap, cancellation, or
  retry exhaustion. Unfinished rows remain for the subsequent minute.
- Hitting the normal batch cap reports a capacity-limited completion. Failure,
  retry exhaustion, or a deadline reached before safe completion must be
  observable as unsuccessful (nonzero).
- Platform retries may exist but must be finite: configure a finite platform
  timeout and retry count under #334 consistent with the job budget, never
  unbounded immediate retries.

### Shutdown and crash semantics

On SIGTERM, the job stops claiming new rows, allows in-flight work only
within the remaining bounded deadline, rolls back uncommitted work, and
releases locks and closes connections on a best-effort bounded cleanup.
SIGKILL recovery is database rollback. Persisted rows are never deleted or
purged during retries.

A broker acknowledgment followed by a crash, mark failure, or commit
uncertainty may replay the same logical event. The relay must never
regenerate `event_id`, `request_id`, `occurred_at`, or the payload/event
type. Consumers deduplicate transactionally; there is no exactly-once
transport or global ordering promise. A failed publication leaves the row
`PENDING` — never mark a row published without an ack. A deterministically
bad payload stays visible as pending for operator intervention; it is not
silently discarded. DLQ/replay tooling is tracked separately under #336.

### Delivery objective

The objective is two minutes from a committed outbox write to a confirmed
broker publish, under a healthy scheduler, database, and broker and
within-capacity load. It is not a hard SLA and not an end-to-end projection
guarantee: cold starts, scheduler delays or missed ticks, broker or database
failure, and backlog may exceed it. There is no latency bound during outages;
resumed schedules recover old pending rows when dependencies return. This
objective does not ensure any consumer application processes the event within
two minutes. Capacity, oldest-pending age, and errors are operational
signals; no metrics schema is invented here (#338 covers that separately).

### Cost

There is no idle relay compute between scheduled runs, but this is not free
infrastructure: frequent startup (4 jobs every minute), resource use, shared
subscription allowances, and separately billed database, broker, network, and
logging can incur charges. API minimum replicas of zero are unaffected; periodic
database access can keep a database awake. No numeric cost claims are made.
See [Azure Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).

## Alternatives Considered

- **Keep HTTP-triggered drain plus productive-worker drains:** both lack idle
  delivery; pending rows can wait indefinitely when there is no traffic or
  new domain work.
- **Always-on relay:** simpler with lower startup latency, but rejected on
  the approved budget direction — no always-on paid relay.
- **One central job covering all databases:** a shared all-DB credential
  weakens per-service ownership and couples failures across services.
- **Azure Functions timer trigger:** a viable alternative, not selected
  because scheduled Jobs fit the selected ACA deployment target and let the
  four relays share one container image. This decision does not claim
  Functions timers are unreliable or that Functions could not run free.
- **Change Data Capture:** complexity unnecessary for this scale.

## Consequences

Completing #322 is this accepted design and the aligned spec text — not the
delivery of the relay. Follow-up work:

- **#334** — implementation, local orchestration, runtime configuration, and
  regression tests.
- **#347** — recovery evidence: verify behavior with no traffic and no new
  work, more than one batch, broker recovery, overlapping replicas, kill
  after publish before commit, stable event IDs, and one domain effect.
- **#336** — DLQ/replay tooling; **#338** — operational metrics schema.

This documentation-only change does not implement application, schema,
OpenAPI, deployment, or CI changes.
