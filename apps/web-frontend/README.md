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
npm run dev            # Vite dev server; proxies /api/* to local services
npm run dev:mock       # distinct mock mode (no MSW yet)
npm run build          # tsc -b && vite build into dist/
npm run api:generate   # regenerate wire types and Zod schemas from docs/openapi
npm run api:check      # fail when generated contracts drift from docs/openapi
npm run bundle:check   # fail when built browser assets contain proxy configuration
npm run preview        # serve the production build on 127.0.0.1:4173
npm run format:check   # Prettier
npm run typecheck      # strict project-reference type check
npm run lint           # ESLint flat config, zero warnings
npm run test           # Vitest unit/integration
npm run test:coverage  # coverage with the delivery thresholds
npm run test:e2e       # Playwright smoke
npm run test:a11y      # axe on the app shell
npm run test:visual    # 390x844 and 1440x900 shell baselines
npm run perf           # Lighthouse CI against the preview server
npm run verify         # the complete gate, in order
```

## Local environment

Real mode is the default. Copy `.env.example` to `.env.local` to point the
server-only proxy targets at non-default service ports. Targets are never
`VITE_`-prefixed, so they are not inlined into the browser bundle.

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
