# Service OpenAPI contracts

This directory is the **source of truth for the HTTP wire contract** of the four
Galaxify Phase 1 services:

| Service | Document | Local origin | Browser prefix |
| --- | --- | --- | --- |
| User Service | [`user-service.yaml`](./user-service.yaml) | `http://localhost:8081` | `/api/user` |
| Daily Service | [`daily-service.yaml`](./daily-service.yaml) | `http://localhost:8082` | `/api/daily` |
| Ship Service | [`ship-service.yaml`](./ship-service.yaml) | `http://localhost:8083` | `/api/ship` |
| Expedition Service | [`expedition-service.yaml`](./expedition-service.yaml) | `http://localhost:8084` | `/api/expedition` |

Each document is OpenAPI `3.1.0`. The documents are self-contained: the shared
error envelope, `bearerAuth` security scheme, `X-Request-Id` parameter/header,
and health response are inlined in every file (rather than `$ref`-ing a common
file) so the documents can be loaded and generated independently.

Authority is split as follows:

1. `docs/specs/*.md` define **requirements**;
2. these OpenAPI documents define the **HTTP wire contract**;
3. the Go handlers are the **implementation** and are held to the contract by
   the conformance tests in `pkg/httpcontract` and each service's
   `internal/handler/conformance_test.go`.

If the spec prose and the handlers disagree, the discrepancy is a bug: fix the
handler or the contract. Do not silently widen the contract to match a handler.

## `x-implementation-status`

Every operation carries `x-implementation-status`:

- `implemented` (the default when the extension is absent) — describes exactly
  what the Go service does today. Conformance tests exercise these operations
  and fail if any is missing from the real route table, or if the wire bytes do
  not match the declared schemas.
- `planned` — a locked Phase 1 contract change from
  [`docs/specs/web-frontend.md` §7.1](../specs/web-frontend.md#71-required-contract-changes)
  that the handlers do **not** implement yet. Planned operations carry
  `x-planned-changes` and `x-ticket` describing the delta, and may be absent
  from the service's mux.

Additive planned request fields are declared as optional properties with
`x-implementation-status: planned`. Incompatible planned shapes keep the
operation modelling today's wire bytes and are described with a named
`*-Planned`-style component schema plus `x-planned-changes`.

`planned` is a promise, not a permission: nothing marked `planned` is validated
against a running service yet. When the follow-up backend ticket lands, flip the
operation/property to `implemented`, add a conformance case, and remove the
`x-planned-changes` note.

A `planned` component schema may exist without any operation referencing it:
`MaterialEffect` in `daily-service.yaml` is a reserved, deferred shape —
`DailyHistory` has no effects today and `dailyComplete` reports its award as
`awarded_materials`. An unreferenced planned schema is not part of any request
or response contract; it only surfaces in the generated frontend output as an
exported declaration (type, Zod schema, index re-export). The schema does not
link an implementation ticket.

`x-ticket` on an `implemented` element records the ticket that shipped it;
keep it as historical implementation reference rather than removing it.

## Validation and drift commands

```sh
make openapi-validate   # load + Validate every document under docs/openapi
make openapi-check      # kin-openapi request/response conformance + route drift
```

`make openapi-validate` loads every document with kin-openapi and fails on any
schema error, duplicate/missing `operationId`, or a planned operation without an
`x-planned-changes`/`x-ticket` note.

`make openapi-check` runs the conformance suites. Each suite:

1. builds the service's **real** handler with its existing test doubles,
2. registers the real routes on an `http.ServeMux` wrapped in
   `sharedhttp.RequestIDMiddleware`,
3. proves every `implemented` spec operation is registered under the exact
   Go 1.22 pattern (`mux.Handler`) and that the caller's declared route set
   equals the spec's implemented set,
4. runs table-driven request/response exchanges through `openapi3filter`
   (`pkg/httpcontract.ValidateExchange`) covering happy paths, 422 validation
   errors with `field_errors`, 404/409, 401 `AUTH_MISSING_HEADER`, and 500s,
5. asserts every response carries a UUID `X-Request-Id`.

Contract failures identify the operation and the exchange, for example:

```text
openapi: operation dailyList (GET /dailies): request violates contract: parameter "status" ...
openapi: operation userRefresh (POST /auth/refresh): response 401 violates contract: ...
```

`pkg/httpcontract.ValidateExchangeResponse` is the escape hatch for exchanges
whose request intentionally violates the contract (malformed JSON, an out-of-enum
value): those still validate the response bytes and still identify the
operation. `pkg/httpcontract.RunExchange` packages the serve/validate/assert
sequence each suite would otherwise repeat.

The declared route set lives next to each service's route table because
`http.ServeMux` does not expose the patterns it has registered. The check
therefore catches a spec operation that is missing from the mux and a declared
operation that is missing from the spec, but a route that a service registers
without declaring it in either place is caught by review, not by this test.

When changing a `pkg/` package, also run the per-module contract from
[`AGENTS.md`](../../AGENTS.md):

```sh
cd pkg && go build ./... && go test ./... && go vet ./...
```

and repeat in every service that imports the changed code.

> **Known workspace limitation.** `go mod tidy` is not workspace-aware: because
> `pkg/httpcontract` is not in a published `pkg` pseudo-version yet, running
> `go mod tidy` inside a service tries to fetch the package from the module
> proxy and fails. This repo intentionally does not use `replace` directives
> (see [`docs/adr/0001`](../adr/0001-go-workspace-monorepo.md)), so use
> `go work sync` from the repo root plus workspace-mode `go build`/`go test`/
> `go vet`. CI does the same (see
> [`.github/workflows/reusable-go-build.yml`](../../.github/workflows/reusable-go-build.yml)).

## Frontend generation

The frontend package owns the generated wire types and Zod schemas under
`apps/web-frontend/src/api/generated/{user,daily,ship,expedition}`. The
generator is `@hey-api/openapi-ts`, configured by
[`apps/web-frontend/openapi-ts.config.ts`](../../apps/web-frontend/openapi-ts.config.ts),
which reads the four documents here and enables only the `@hey-api/typescript`
and `zod` plugins — no HTTP client, SDK, or TanStack Query plugins (feature
adapters own operations and query semantics).

After any contract change, regenerate and commit the output from
`apps/web-frontend` (see its
[`package.json`](../../apps/web-frontend/package.json)):

```sh
npm run api:generate   # openapi-ts -f openapi-ts.config.ts
npm run api:check      # generate, then git diff --exit-code -- src/api/generated
```

`api:check` already runs inside `npm run verify`, so checked-in generated
output that drifts from `docs/openapi` fails the frontend verify pipeline.
The resolved generator, TypeScript, and zod versions are the ones in
[`apps/web-frontend/package-lock.json`](../../apps/web-frontend/package-lock.json)
— check the lockfile or `npm ls` rather than trusting this document.

`make openapi-generate` at the repo root is a standalone scratch tool: it runs
`npx -p typescript@5.6.3 -p @hey-api/openapi-ts@0.99.0 openapi-ts` against every
document and writes to the gitignored `.openapi-generated/` directory. Its
pinned versions are independent of the frontend toolchain and are not evidence
of frontend compatibility; the target also deletes its output directory first.

Ongoing frontend dependency upgrades (TypeScript, MSW, ESLint — e.g. PRs #218,
#282, #283) are tracked separately and are outside the scope of this directory.
