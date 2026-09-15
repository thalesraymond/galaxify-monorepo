# User Service Real-Stack Convergence — Evidence

Ticket: [#162 "Converge session and Profile with the real User Service"]
Scope: prove the browser session/Profile capability (merged via #153) against the
real User Service and the locked OpenAPI contract before cross-loop composition.

- Governing specs: `docs/specs/web-frontend.md` §4 (session lifecycle), §5.1
  (signup/login), §5.8 (Profile/account actions), §7 (integration contract);
  `docs/specs/web-frontend-delivery.md` §4 (changed-module verification), §8
  (release evidence).
- Contract truth: `docs/openapi/user-service.yaml` (locked; not modified).

## Environment

| Item | Value |
| --- | --- |
| Worktree | `galaxify-monorepo.worktree/ticket/162-user-convergence` (branch `ticket/162-user-convergence`, forked from `main` @ `10feef4`) |
| Date | 2026-09-14/15 (local `-03:00`), Go `go1.26` (`go version`), Node `v24.14.0`, npm `11.19.1` |
| Postgres | docker `galaxify-monorepo-postgres-user-1`, `user_db` on `localhost:5431`, migration version 7 (`./goose.sh up`) |
| RabbitMQ | docker `galaxify-monorepo-rabbitmq-1` on `localhost:5672` |
| User Service | `apps/user-service`, built to gitignored `bin/` (`go build -o bin/ .`), started `nohup ./bin/user-service`, listening `:8081` |
| Vite (real mode) | `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`, browser prefix `/api/user` proxied to `http://localhost:8081` |
| Playwright driver | `apps/web-frontend/e2e/real-user.spec.ts` (gated: `RUN_REAL_STACK=1`) |

Run command for the whole matrix:

```sh
# from apps/user-service (after goose up + go build -o bin/ .)
nohup ./bin/user-service > /tmp/user-service-162.log 2>&1 &

# from apps/web-frontend
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort &

RUN_REAL_STACK=1 npx playwright test e2e/real-user.spec.ts --project=chromium --reporter=list
```

## Go suite (baseline and after the fix — both green)

From `apps/user-service` (module unchanged by any other lane; the only Go
changes in this ticket are inside `apps/user-service/internal/handler`):

```text
$ go build ./...
$ go vet ./...
$ go test ./...
ok   github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/handler
ok   github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/session
?    .../internal/database, .../internal/outbox, ... (no test files)
```

- Handler package includes the kin-openapi conformance suite
  (`internal/handler/conformance_test.go`, `TestOpenAPIConformance`): all wire
  exchanges validated against `docs/openapi/user-service.yaml` — **green before
  and after the timestamp fix**.
- Race detector (full module, includes the session concurrency tests such as
  `TestManagerRotateConcurrentReuseRevokesFamily`):

  ```text
  $ go test -race ./...
  ok   github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/handler  2.987s
  ok   github.com/thalesraymond/galaxify-monorepo/apps/user-service/internal/session   1.008s
  ?    .../internal/database, .../internal/outbox, ... (no test files)
  ```

- `gofmt -l apps/user-service/` reports nothing (all files formatted).
- No `pkg/` code changed, so no other module required re-verification
  (`git diff` scope confirms changes are confined to `apps/user-service` +
  `apps/web-frontend`).

## Frontend gate

`apps/web-frontend` was unchanged by the mismatch fix (the fix landed at the
service boundary), but the new gated spec is part of the frontend tree:

```text
npm run format:check  ✔
npm run typecheck     ✔
npm run lint          ✔ (zero warnings)
npm run build         ✔
npm run test          ✔ 20 files / 117 tests
```

The new spec also typechecks (`tsc -b` includes `e2e/`) and lints clean.

## Real-stack scenario matrix

All scenarios below ran against the real routes through the Vite proxy; every
HTTP exchange was a live User Service request (no MSW). Final result of the
committed serial Playwright run (post code-review hardening): **13 passed**
(26.8 s), incl. the outage test which stops and restarts the real service and a
suite-level `afterAll` that terminates every respawned service:

```text
✓ 1 wire contract / health / signup / me / patch / delete        (666ms)
✓ 2 refresh single-use: consume once, reuse revokes the family   (1.1s)
✓ 3 logout: refresh_token body, no auth header, 204, revoked     (1.1s)
✓ 4 login: normalized email                                      (590ms)
✓ 5 signup + bootstrap rotation on reload                        (2.3s)
✓ 6 threshold gating: fresh token, no premature rotation         (1.7s)
✓ 7 reactive refresh: one 401 -> one real rotation -> one replay (1.7s)
✓ 8 cross-tab serialization: 2 concurrent reloads, zero 401s     (3.6s)
✓ 9 terminal invalidity syncs every tab                          (3.3s)
✓10 profile: get / update / validation / real 409 conflict       (2.7s)
✓11 logout (UI): family revoked, state cleared                   (2.2s)
✓12 deletion: password-confirmed, no logout call                 (1.7s)
✓13 retryable outage: kill -> unavailable -> restart -> Retry    (2.6s)
```

| # | Scenario | Evidence |
| --- | --- | --- |
| 1 | Wire contract conformance | `/health`, `POST /users` (201), `GET /users/me`, `PATCH /users/me`, `DELETE /users/me` all parse with the generated Zod contract (the shapes the browser parses); `X-Request-Id` echoed on every response; error envelope `{error:{code,message,details.field_errors}}` on 422/401. |
| 2 | Refresh single-use | First `POST /auth/refresh` 200 + replacement token; reusing the consumed token → 401 `AUTH_INVALID_TOKEN`; the replacement is revoked too (family revocation). |
| 3 | Logout contract | `POST /auth/logout` with only `refresh_token` body and **no Authorization header** → 204; revoked family cannot refresh (401). |
| 4 | Login normalization | Login with an UPPERCASE email succeeds (service normalizes to lower case). |
| 5 | Signup + bootstrap rotation | Signup enters the Dashboard; the **only** persisted key is the versioned refresh-token key (exclusivity: no access token, cache, or drafts); reload restores the session through a real startup rotation (stored token changes; consumed startup token is single-use 401). |
| 6 | Threshold gating (proactive, negative) | Fresh access token + real activity + authenticated read: zero premature rotations (60 s threshold respected). |
| 7 | Reactive refresh | One fabricated 401 `AUTH_INVALID_TOKEN` at the browser network boundary on a bearer-protected mutation → exactly one real `POST /auth/refresh` rotation → exactly one replay of the `PATCH /users/me` (200) → the change persists and the session is recovered. |
| 8 | Cross-tab serialization (2 tabs) | Second-tab bootstrap = 1 rotation; two concurrent reloads = exactly 2 more rotations, **zero 401s** (named Web Lock + post-lock storage re-read); final stored token is the only live lineage (200), pre-storm token consumed (401). |
| 9 | Terminal invalidity | Corrupt stored refresh token → reload → `/login` with "Your session ended. Sign in again."; local storage cleared; the durable storage signal ends the second tab without a reload. |
| 10 | Profile get/update | Read-only email and **member-since (rendered `created_at`)** plus editable username from `GET /users/me`; inline client validation; real 409 → inline "That username is already taken."; update persists across reload via `PATCH /users/me`. |
| 11 | Logout (UI) | Account menu → Log out → "You have been signed out."; stored token cleared; post-logout refresh with the old token → 401 (family revoked). |
| 12 | Deletion (UI) | Password-confirmed `DELETE /users/me` → 204; lands on Signup; state purged; **no `/auth/logout` call** (network log); login with deleted account → 401 `USER_INVALID_CREDENTIALS`. |
| 13 | Retryable outage | Real process kill of `user-service` → reload shows "We could not restore your session" with Retry; the stored refresh token is retained (never a sign-out); service restarted → Retry performs a real bootstrap rotation → Dashboard restored. |

### Single-use lineage (SQL check)

Independent SQL capture on a fresh account against the real database (subset of
the endpoint-level evidence above):

```text
after signup:                    after one rotation:
 used | count                     used | count
------+-------                   ------+-------
 f    |     1                     f    |     1     <- the live lineage token
                                 t    |     1     <- the consumed token
family_id: 1ca85dfd-2912-4bcf-86de-bbcccb57f3fa
```

Exactly one unused token per family after any rotation stream — the concurrent
refresh produces a single valid lineage, never a reuse.

### Outage detail

The outage test targets only the user-service process by command line
(`pgrep -f 'bin/user-service'`), sends `SIGTERM`, waits until the proxy health
check fails, reloads the app, respawns `./bin/user-service` from
`apps/user-service`, waits for health, and clicks Retry. Every respawned child
is tracked and terminated by a suite-level `afterAll`, so an aborted run cannot
orphan a live service.

## Mismatch found and fixed

1. **Timestamps not canonical UTC (service boundary).** The User Service
   formatted `created_at`/`updated_at` with `time.RFC3339` in the server's local
   zone (e.g. `2026-09-14T22:02:57-03:00`). The locked contract declares RFC3339
   `date-time`, and both the frontend contract parser (`z.iso.datetime()`, the
   generated schema) and the MSW fixtures emit/accept the UTC `Z` form — so a
   fully valid RFC3339 offset response **failed the browser parse**: signup
   returned 201 yet the app showed "We could not reach the service. Try again."
   and never adopted the session.
   - Fix (owning boundary = the service that owns the wire timestamps):
     `apps/user-service/internal/handler/timestamps.go` adds
     `formatTimestamp(t)` = `t.UTC().Format(time.RFC3339)`; used by the Login,
     Signup, and `/users/me` response builders. No OpenAPI schema change, no
     mock change (`@/mocks/fixtures.ts` already emits `…Z` via `toISOString()`),
     so mock parity is preserved and the wire shape the mocks model is exactly
     what the service now emits.
   - Tests: table-driven `timestamps_test.go`; `TestOpenAPIConformance` green.
   - Verified after the fix: signup → Dashboard → Profile round trip parses and
     the session is adopted (see matrix).

2. **Logout carries an incidental bearer header (verified, not a defect).** The
   logout UI flow sends `Authorization: Bearer …` because the session transport
   attaches the in-memory access token. The contract requires *no* access token
   — the service does not require, validate, or reject the header, and the
   endpoint proof (matrix #3) shows logout works with no header at all. No
   change made; documented to avoid a future "fix".

No other mismatches were found: refresh request/response shape, logout body
field (`refresh_token`), login/signup request fields, normalized email, profile
`PATCH` body (`username`), deletion `DELETE` body (`password`),
`AUTH_INVALID_TOKEN` vs retryable 5xx classification, and the transport's
single replay on `AUTH_INVALID_TOKEN` all conform to the locked contract.

## Proactive-refresh coverage note

The spec exercises the proactive paths that are observable against real tokens
(matrix #5 startup rotation, matrix #6 threshold gating). The remaining
near-expiry proactive branches ("before authenticated work when expiry is within
60 s" and the visible/recently-active timer) are covered deterministically by
the session manager's unit suite (`src/features/auth/session/sessionManager.test.ts`,
manual clock). Warping the browser clock to force them against the real service
is not viable: the service mints access tokens with a real 15-minute `exp`, so a
fake clock pushed past `exp − 60 s` makes every rotation re-enter the threshold
and the proactive scheduler re-rotates in a tight loop (an artifact of the fake
clock vs. real token expiry, not a product defect — under real time the
scheduled delay is always ~14 minutes). This was observed and discarded during
harness development; the spec instead asserts the observable, stable guarantees.

## Reproducibility

- The gated spec (`apps/web-frontend/e2e/real-user.spec.ts`) documents its env
  requirements in its header and runs offline against the local stack.
- To reconfirm the Go suite: `cd apps/user-service && go build ./... && go vet
  ./... && go test ./...`.
- The evidence in this file was produced by a single serial Playwright run with
  `RUN_REAL_STACK=1`; results are attached to the ticket/PR.

[Ticket #162]: https://github.com/thalesraymond/galaxify-monorepo/issues/162
