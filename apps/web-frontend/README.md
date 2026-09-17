# web-frontend

The Phase 1 Galaxify React frontend. This directory is the Vite/React
application foundation: strict TypeScript, feature-first folders with narrow
entry points, app providers and a lazy route tree, and the full engineering
gate (format, types, lint, coverage, build, E2E, accessibility, visual
regression, and Lighthouse performance).

- [Product and application specification](../../docs/specs/web-frontend.md)
- [Visual design system](./DESIGN.md)
- [Delivery and verification specification](../../docs/specs/web-frontend-delivery.md)

## Stack

React 19, strict TypeScript 5, Vite 7, React Router 7, TanStack Query 5,
React Hook Form, Zod, Vitest/React Testing Library, Playwright with axe, and
Lighthouse CI. npm owns dependency reproducibility (`package-lock.json` plus
the `packageManager`/`engines` fields).

## Layout

```text
src/
├── app/            startup, providers, routes, shells, error boundary
├── api/            generated OpenAPI wire contracts and domain-neutral transport
├── features/       auth, profile, dailies, ship, expeditions
│                   each exposes one public entry point: index.ts
├── shared/         domain-neutral UI and styles only
├── test/           Vitest setup, render helper, and boundary probe
└── main.tsx        browser entry point
```

`@/` is an alias for `src`. Import another feature only through its
`index.ts`; ESLint (`boundaries/dependencies`) rejects cross-feature deep
imports and the rule is proven by `src/test/feature-boundaries.test.ts`.
Server state belongs to TanStack Query — `no-restricted-imports` forbids
`zustand`, `redux`, `@reduxjs/toolkit`, `jotai`, `recoil`, and `mobx`.

## Commands

```sh
npm ci                 # frozen, deterministic install
npm run dev            # Vite dev server; proxies /api/* to real local services
npm run dev:mock       # Vite + deterministic MSW handlers (no Go services needed)
npm run build          # tsc -b && vite build into dist/
npm run api:generate   # regenerate wire types and Zod schemas from docs/openapi
npm run api:check      # fail when generated contracts drift from docs/openapi
npm run bundle:check   # proxy-leak inspection + §8 gzip budgets (200/150 KiB)
npm run preview        # serve the production build on 127.0.0.1:4173
npm run format:check   # Prettier
npm run typecheck      # strict project-reference type check
npm run lint           # ESLint flat config, zero warnings
npm run test           # Vitest unit/integration
npm run test:coverage  # coverage with the delivery thresholds
npm run test:orchestration  # repository supervisor helper tests
npm run test:e2e       # Playwright smoke
npm run test:e2e:mock  # Playwright smoke against the MSW dev server
npm run test:cross-browser  # Firefox, WebKit, and mobile WebKit release journeys
npm run test:a11y      # axe + the release accessibility checklist automation
npm run test:visual    # 390x844 and 1440x900 shell baselines
npm run perf           # Lighthouse CI against the unauthenticated preview route
npm run perf:dashboard # authenticated real-stack Dashboard Lighthouse (requires make dev)
npm run verify         # the complete gate, in order
```

Root shortcuts: `make dev`, `make dev-infra`, `make dev-down`,
`make dev-reset` (requires confirmation), `make frontend-install`, and
`make frontend-verify`. For isolated mock work use `npm run dev:mock` here (no
Go services needed).

## Local environment

Real mode is the default. Copy `.env.example` to `.env.local` (gitignored) to
point the server-only proxy targets at non-default service ports. Targets are
never `VITE_`-prefixed, so they are not inlined into the browser bundle:

| Variable | Purpose | Default |
| --- | --- | --- |
| `USER_SERVICE_PROXY_TARGET` | Vite proxy target for `/api/user` | `http://localhost:8081` |
| `DAILY_SERVICE_PROXY_TARGET` | Vite proxy target for `/api/daily` | `http://localhost:8082` |
| `SHIP_SERVICE_PROXY_TARGET` | Vite proxy target for `/api/ship` | `http://localhost:8083` |
| `EXPEDITION_SERVICE_PROXY_TARGET` | Vite proxy target for `/api/expedition` | `http://localhost:8084` |
| `VITE_MOCK_SCENARIO` | Mock scenario for `npm run dev:mock` | `established-player` |

Invalid proxy targets and unknown scenario names fail at startup with
actionable errors. `VITE_MOCK_SCENARIO` is browser-visible by design; scenario
selection never comes from query parameters.

## Mock mode

`npm run dev:mock` runs the same browser code against strict MSW handlers over
the generated `/api/{service}` contracts. Real and mock modes use identical
relative paths, so feature code never knows which mode is active.

The named scenarios are:

`anonymous`, `provisioning`, `established-player` (default), `damaged-ship`,
`expedition-ready`, `active-expedition`, `resolved-expedition`,
`expired-session`, `service-outage`, `delayed-propagation`.

Set the scenario in `.env.mock.local` (gitignored) or inline:

```sh
VITE_MOCK_SCENARIO=damaged-ship npm run dev:mock
```

Handlers use fixed factories, fixed IDs, and an injectable clock; there is no
randomness or wall-clock dependence. Mock state is namespaced and versioned
(`galaxify.mock.v1`) in `localStorage`, synchronized across tabs with
BroadcastChannel and the `storage` event, and resets automatically when the
scenario changes. A development-only reset control is exposed on
`window.__galaxifyMock`. Unhandled `/api/**` requests return
`MOCK_UNHANDLED_REQUEST` instead of silently hitting the network.

Tests reuse the same handlers through an isolated in-memory backend
(`createMockTestServer`) with the response delay disabled and the fake clock
advanced explicitly, so asynchronous behavior is deterministic.

## Real-stack smoke

The Phase 1 release evidence (`docs/specs/web-frontend-phase1-release-evidence.md`)
includes one real-stack journey from signup through logout, driven by the gated
spec `e2e/real-stack-smoke.spec.ts`. It is skipped unless `RUN_REAL_STACK=1`.

```sh
# 1. Healthy infrastructure (or `make dev-infra`); attach when it already runs:
#    node scripts/dev.mjs --no-infra
# 2. Full stack with a short missed-Daily sweep so the hull-damage leg is fast:
CRON_INTERVAL=15s make dev

# 3. From apps/web-frontend:
RUN_REAL_STACK=1 npx playwright test e2e/real-stack-smoke.spec.ts --project=chromium
```

The journey covers signup provisioning, reload restoration, Daily
create/complete, the observed Daily-to-Ship materials effect, missed-Daily
hull damage, eligible repair, Expedition launch, Profile update, and logout —
all through the Vite proxies against the real services, RabbitMQ, and workers.

### Dashboard Lighthouse evidence

`npm run perf` is CI-safe and measures the unauthenticated Login route. The
release gate separately requires a representative authenticated Dashboard
measurement. With the real stack running and a production build available:

```sh
npm run build
npm run perf:dashboard
```

The command creates a new account through the production preview, reuses its
real persisted session for `/dashboard`, writes the report under
`.lighthouseci/dashboard-lhr.json`, and fails below performance 90 or
accessibility 95. It has no retries and does not use MSW.

## Troubleshooting

- **`make dev` reports an occupied port**: another stack owns it. Run
  `make dev-down`, or attach to healthy infrastructure with
  `node scripts/dev.mjs --no-infra`.
- **`npm run dev:mock` exits immediately**: `VITE_MOCK_SCENARIO` is unknown; the
  error lists every valid name.
- **A mock request returns `MOCK_UNHANDLED_REQUEST`**: the scenario does not
  model that route; add a handler or switch scenarios.
- **Real mode shows network errors**: confirm `make dev` or `make dev-infra`
  is healthy, then check the `*_PROXY_TARGET` values in `.env.local`.
- **`make dev-reset` is refused**: it requires an explicit `y`/`yes`; it
  permanently deletes local volumes before reapplying migrations.
- **`test:cross-browser` fails to launch WebKit on non-Ubuntu Linux**: WebKit
  needs `libicu74`, `libxml2` (soname `.so.2`), and `libflite1`. On Debian/Ubuntu
  run `npx playwright install-deps webkit`; on other distributions supply those
  libraries (the Playwright WebKit bundle's `sys/lib` directory is on its
  loader path and accepts them) — see the environment notes in
  `docs/specs/web-frontend-phase1-release-evidence.md`.

## API boundary


`src/api/transport.ts` is the only browser transport. It accepts relative
`/api/{service}` paths, injects a bearer token and request ID, handles JSON and
no-content responses, validates success bodies with generated Zod schemas, and
normalizes errors. Feature-local `api/` modules own operations, query keys, and
typed mappings such as provisioning or no-current-expedition outcomes.

OpenAPI generation produces types and Zod schemas only—never a generated SDK,
hooks, or HTTP client. Generated output under `src/api/generated/` is committed
and must be regenerated after changes under `docs/openapi/`.

`npm run verify` records both generation-drift and post-build proxy inspection
evidence: it regenerates contracts, fails on a checked-in drift, builds the app,
and verifies the browser assets contain neither proxy variable names nor proxy
target values (including configured local production env files).

Root shortcuts: `make dev`, `make dev-infra`, `make dev-down`,
`make dev-reset` (requires confirmation), `make frontend-install`, and
`make frontend-verify`.
