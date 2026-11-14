# Web Frontend Conventions (`apps/web-frontend`)

Contextual guide for `apps/web-frontend/` (React 19, strict TypeScript, Vite, React Router, TanStack Query, React Hook Form, Zod). Runs as an independent npm project outside `go.work`.

## Reference docs

- Product & application spec: [`docs/specs/web-frontend.md`](../specs/web-frontend.md)
- Delivery & verification spec: [`docs/specs/web-frontend-delivery.md`](../specs/web-frontend-delivery.md)
- Accessibility checklist: [`docs/specs/web-frontend-accessibility-checklist.md`](../specs/web-frontend-accessibility-checklist.md)
- Visual design system & product brief: [`apps/web-frontend/DESIGN.md`](../../apps/web-frontend/DESIGN.md), [`apps/web-frontend/PRODUCT.md`](../../apps/web-frontend/PRODUCT.md), [`apps/web-frontend/README.md`](../../apps/web-frontend/README.md)
- OpenAPI wire contracts: [`docs/openapi/README.md`](../openapi/README.md)

## Architecture & module boundaries

- `@/` aliases `src/`.
- **Feature isolation**: `src/features/{auth,profile,dailies,ship,expeditions}` expose a single public entry point (`index.ts`). Cross-feature deep imports are enforced as errors by [`eslint.boundaries.js`](../../apps/web-frontend/eslint.boundaries.js) and tested in [`feature-boundaries.test.ts`](../../apps/web-frontend/src/test/feature-boundaries.test.ts).
- **Server state**: Use TanStack Query exclusively for server state (alternate client state libraries are disallowed by ESLint `no-restricted-imports`).
- **API & wire contracts**: [`src/api/transport.ts`](../../apps/web-frontend/src/api/transport.ts) is the sole browser HTTP transport. [`src/api/generated/`](../../apps/web-frontend/src/api/generated/) holds committed TypeScript types and Zod schemas generated from `docs/openapi/*.yaml` (`npm run api:generate` / `npm run api:check`) — generate types and Zod schemas only.
- **Downstream reconciliation**: Bounded observation of asynchronous backend effects lives in the shared reconciliation subsystem (see [`docs/wiki/subsystems/downstream-reconciliation.md`](../wiki/subsystems/downstream-reconciliation.md)).

## Verification commands (run from `apps/web-frontend`)

```sh
npm run format:check   # Prettier check (*.md excluded)
npm run typecheck      # tsc -b strict typecheck
npm run lint           # ESLint flat config, --max-warnings 0
npm run test           # Vitest unit/integration suite
npm run test:coverage  # Vitest with delivery coverage thresholds
npm run api:check      # Regenerate OpenAPI types/schemas and fail on drift
npm run build          # Production build into dist/
npm run bundle:check   # Proxy-leak inspection and gzip size budgets
npm run verify         # Full release verification gate
```

## Worktree & E2E pitfalls

- Check [`docs/wiki/problems/parallel-playwright-worktrees.md`](../wiki/problems/parallel-playwright-worktrees.md) before running Playwright E2E or visual suites across multiple worktrees (fixed ports `4174`/`4175` and shared visual baselines).
