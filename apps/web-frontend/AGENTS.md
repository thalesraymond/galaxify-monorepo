# Web Frontend Agent Guide

**Location**: `apps/web-frontend` (repo root: [`../..`](../..), global config: [`../../AGENTS.md`](../../AGENTS.md), frontend guide: [`../../docs/agents/web-frontend.md`](../../docs/agents/web-frontend.md)). Not part of the Go workspace (`go.work`).

## Role

- **Scope**: Phase 1 React 19 + strict TypeScript SPA (Vite, React Router, TanStack Query, React Hook Form, Zod) covering auth, profile, dailies, ship status/repair, and expedition tracking.
- **Ports & modes**:
  - Real mode (`npm run dev` on `:5173`, `npm run preview` on `127.0.0.1:4173`): proxies `/api/user` (`8081`), `/api/daily` (`8082`), `/api/ship` (`8083`), and `/api/expedition` (`8084`) using server-only env vars in [`.env.example`](.env.example).
  - Mock mode (`npm run dev:mock`, Playwright mock/outage servers on `127.0.0.1:4174` / `127.0.0.1:4175`): intercepts `/api/{service}` in the browser via deterministic MSW handlers ([`src/mocks/`](src/mocks/)) without running Go services, PostgreSQL, or RabbitMQ.
- **Boundaries & state**: Feature folders (`src/features/{auth,profile,dailies,ship,expeditions}`) export only via `index.ts` (enforced by [`eslint.boundaries.js`](eslint.boundaries.js) and [`src/test/feature-boundaries.test.ts`](src/test/feature-boundaries.test.ts)). Server state uses TanStack Query only; [`src/api/transport.ts`](src/api/transport.ts) is the sole HTTP client; [`src/api/generated/`](src/api/generated/) holds committed OpenAPI types and Zod schemas.

## Contextual Docs

- Frontend conventions: [`../../docs/agents/web-frontend.md`](../../docs/agents/web-frontend.md)
- App-local docs: [`./DESIGN.md`](DESIGN.md), [`./PRODUCT.md`](PRODUCT.md), [`./README.md`](README.md)
- Domain glossary & wiki: [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md), [`../../docs/wiki/subsystems/downstream-reconciliation.md`](../../docs/wiki/subsystems/downstream-reconciliation.md), [`../../docs/wiki/problems/parallel-playwright-worktrees.md`](../../docs/wiki/problems/parallel-playwright-worktrees.md)
- Specs & OpenAPI: [`../../docs/specs/web-frontend.md`](../../docs/specs/web-frontend.md), [`../../docs/specs/web-frontend-delivery.md`](../../docs/specs/web-frontend-delivery.md), [`../../docs/specs/web-frontend-accessibility-checklist.md`](../../docs/specs/web-frontend-accessibility-checklist.md), [`../../docs/openapi/README.md`](../../docs/openapi/README.md)

## Verification

Run from `apps/web-frontend`:

```sh
npm run format:check
npm run typecheck
npm run lint
npm run test
npm run api:check
npm run verify   # Full release verification gate
```
