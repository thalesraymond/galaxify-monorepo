# Web Frontend Agent Guide

**Location**: `apps/web-frontend` (repo root: [`../..`](../..)). Independent npm/Vite workspace outside `go.work`.

## Role

- **Scope**: Owns the Phase 1 React + TypeScript SPA (`src/app`, `src/api`, `src/features`, `src/shared`). Supports real Vite `/api/*` proxy targets ([`.env.example`](.env.example)) and deterministic MSW mock mode (`npm run dev:mock` via [`src/mocks/`](src/mocks/)).

## Contextual Docs

- Global & frontend rules: [`../../AGENTS.md`](../../AGENTS.md), [`../../docs/agents/web-frontend.md`](../../docs/agents/web-frontend.md)
- Domain & workflow docs: [`../../docs/agents/domain.md`](../../docs/agents/domain.md), [`../../docs/agents/issue-tracker.md`](../../docs/agents/issue-tracker.md), [`../../CONTEXT.md`](../../CONTEXT.md), [`../../docs/wiki/index.md`](../../docs/wiki/index.md)
- Local docs: [`./DESIGN.md`](DESIGN.md), [`./PRODUCT.md`](PRODUCT.md), [`./README.md`](README.md)

## Verification

Run the npm format, typecheck, lint, test, OpenAPI drift, and release checks from this directory per the frontend guide above.
