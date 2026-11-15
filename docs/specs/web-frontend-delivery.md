# Web Frontend Delivery Specification — Phase 1

This document owns implementation sequencing, ticket completion requirements,
and Phase 1 release evidence. Product behavior is owned by
[`web-frontend.md`](./web-frontend.md); visual rules are owned by
[`apps/web-frontend/DESIGN.md`](../../apps/web-frontend/DESIGN.md); wire contracts
will be owned by `docs/openapi/*.yaml` once the OpenAPI foundation lands.

## 1. Source authority

Use one authority per concern:

1. repo specifications define requirements;
2. OpenAPI documents define HTTP wire contracts;
3. `DESIGN.md` defines visual-system requirements;
4. closed wayfinder tickets retain decision rationale;
5. implementation issues define bounded work, dependencies, acceptance
   scenarios, and expected evidence without copying entire specifications.

## 2. Delivery strategy

Work proceeds contract-first in parallel lanes:

1. lock existing and planned service contracts in OpenAPI and establish
   conformance tooling;
2. establish frontend engineering, visual, transport, mock, and local-runtime
   foundations;
3. implement focused backend capabilities and mock-backed frontend player
   capabilities in parallel after their contracts are locked;
4. converge each domain against real services before composing Dashboard;
5. run the complete release evidence gate.

Native GitHub blockers express hard start order. Every fully specified ticket
uses `ready-for-agent`, including blocked tickets; dependencies—not label churn—
govern scheduling. Ticket titles are verb-first and unnumbered so graph changes
do not make names misleading.

The
[Phase 1 implementation epic](https://github.com/thalesraymond/galaxify-monorepo/issues/141)
is the ordered index. Its native sub-issues hold detail.

## 3. Planned implementation graph

Phase 1 delivery was executed under
[Implement Galaxify Phase 1 React product](https://github.com/thalesraymond/galaxify-monorepo/issues/141):

### Foundations

- [#145 — Establish service OpenAPI contracts and conformance testing](https://github.com/thalesraymond/galaxify-monorepo/issues/145).
- [#142 — Scaffold the React application and engineering gates](https://github.com/thalesraymond/galaxify-monorepo/issues/142).
- [#146 — Implement the Captain's Log design system and responsive shell](https://github.com/thalesraymond/galaxify-monorepo/issues/146).
- [#144 — Implement the typed transport and generated API boundary](https://github.com/thalesraymond/galaxify-monorepo/issues/144).
- [#143 — Implement deterministic mocks and local product orchestration](https://github.com/thalesraymond/galaxify-monorepo/issues/143).

### Backend capabilities

- [#149 — Make refresh rotation atomic and add family logout](https://github.com/thalesraymond/galaxify-monorepo/issues/149).
- [#147 — Correct completed Daily edit and delete lifecycle behavior](https://github.com/thalesraymond/galaxify-monorepo/issues/147).
- [#148 — Implement timezone-aware Daily scheduling](https://github.com/thalesraymond/galaxify-monorepo/issues/148).
- [#151 — Expose Daily difficulty, completion-effect, and readiness contracts](https://github.com/thalesraymond/galaxify-monorepo/issues/151).
- [#150 — Paginate Daily History with stable cursors](https://github.com/thalesraymond/galaxify-monorepo/issues/150).
- [#152 — Expose Expedition quote, typed results, and readiness contracts](https://github.com/thalesraymond/galaxify-monorepo/issues/152).

### Mock-backed frontend capabilities

- [#153 — Build authentication, session lifecycle, Profile, and account actions](https://github.com/thalesraymond/galaxify-monorepo/issues/153).
- [#157 — Build Daily management, completion, and history](https://github.com/thalesraymond/galaxify-monorepo/issues/157).
- [#154 — Build Ship status and repair](https://github.com/thalesraymond/galaxify-monorepo/issues/154).
- [#156 — Build Expedition launch, current state, detail, and history](https://github.com/thalesraymond/galaxify-monorepo/issues/156).

### Real-stack convergence

- [#162 — Converge session and Profile with the real User Service](https://github.com/thalesraymond/galaxify-monorepo/issues/162).
- [#160 — Converge Dailies with real Daily-to-Ship propagation](https://github.com/thalesraymond/galaxify-monorepo/issues/160).
- [#159 — Converge Ship repair with real Ship-to-Expedition propagation](https://github.com/thalesraymond/galaxify-monorepo/issues/159).
- [#158 — Converge Expeditions with real Expedition-to-Ship propagation](https://github.com/thalesraymond/galaxify-monorepo/issues/158).

### Composition and completion

- [#155 — Compose the cross-loop Dashboard](https://github.com/thalesraymond/galaxify-monorepo/issues/155).
- [#161 — Complete the Phase 1 frontend release gate](https://github.com/thalesraymond/galaxify-monorepo/issues/161).

### After hours whole-frontend redesign (post-Phase 1 visual replacement)

Visual presentation was subsequently replaced without altering Phase 1 product
or wire contracts under epic
[#285 — Deliver Galaxify's After hours frontend redesign](https://github.com/thalesraymond/galaxify-monorepo/issues/285),
governed by [`frontend-redesign.md`](./frontend-redesign.md):

- [#286 — Establish After hours foundations and responsive navigation](https://github.com/thalesraymond/galaxify-monorepo/issues/286).
- [#287 — Restyle account forms and Profile](https://github.com/thalesraymond/galaxify-monorepo/issues/287).
- [#288 — Restyle Daily management and history](https://github.com/thalesraymond/galaxify-monorepo/issues/288).
- [#289 — Restyle Ship condition and repair](https://github.com/thalesraymond/galaxify-monorepo/issues/289).
- [#290 — Restyle Expedition planning and outcomes](https://github.com/thalesraymond/galaxify-monorepo/issues/290).
- [#291 — Compose the After hours Dashboard summary](https://github.com/thalesraymond/galaxify-monorepo/issues/291).
- [#292 — Verify and close the whole-frontend redesign](https://github.com/thalesraymond/galaxify-monorepo/issues/292).

The linked implementation epics remain the canonical live ordering and
dependency view.

## 4. Agent-ready ticket contract

Every implementation ticket includes:

- links to exact governing specification sections;
- outcome and in-scope work;
- explicit non-goals;
- native parent/blocker relationships;
- acceptance scenarios observable by a Player or contract test;
- changed-module verification commands;
- evidence expected before closure.

Go changes must run `go build ./...`, `go test ./...`, and `go vet ./...` from
every changed module and every module importing changed `pkg/` code. Compiled
binaries go only under a module's ignored `bin/` directory.

Every frontend ticket runs the universal gate:

1. `npm run format:check`;
2. `npm run typecheck`;
3. `npm run lint` with zero warnings;
4. `npm run build`;
5. component/integration tests covering changed and adjacent behavior.

Changes to shared infrastructure, routing, API/session behavior, fixtures, test
configuration, or build configuration run the complete affected suite.

## 5. Frontend verification contract

Expose these scripts:

```text
npm run format:check
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run test:e2e
npm run test:visual
npm run test:a11y
npm run build
npm run perf
npm run verify
```

`npm run verify` is the deterministic integration gate: formatting, strict
types, zero-warning lint, coverage, production build, mock-backed E2E,
accessibility, visual regression, and performance.

Use Vitest, React Testing Library, user-event, shared strict MSW handlers,
Playwright, axe-core, and Lighthouse CI. Query by role/name/label and assert
Player outcomes. Avoid implementation-detail assertions, broad snapshots,
arbitrary sleeps, wall-clock dependence, and copied fixture JSON.

Manually authored production source maintains at least 70% lines, 70%
statements, 70% functions, and 60% branches. Generated contracts, declarations,
configuration, test support, and fixtures are excluded. Critical session
rotation, mutation rollback, validation, recovery, provisioning, stale data, and
reconciliation branches require explicit scenarios regardless of percentages.

## 6. Required deterministic journeys

Mock-backed Chromium covers:

1. signup/provisioning, login, reload restoration, terminal expiry, and logout;
2. Daily create/edit/delete/complete/history, rollback, and delayed Ship update;
3. Ship read/repair and delayed Expedition readiness;
4. Expedition launch/current/resolution/history and delayed/retry behavior;
5. Profile update, validation, recoverable failure, and deletion.

Firefox, WebKit, and mobile WebKit cover representative signup/session restore,
primary navigation, one mutation/recovery path, and logout.

## 7. Local runtime and mocks

Canonical commands are:

```text
make dev
make dev-infra
make dev-down
make dev-reset
npm run dev
npm run dev:mock
```

Real mode is the default. A repository-owned supervisor starts healthy
infrastructure, migrations, User Service, remaining services, workers, and Vite;
prefixes logs; fails on child exit; and cleans up application children. Normal
shutdown preserves data/infrastructure. Reset requires confirmation.

Vite reads server-only proxy targets for User, Daily, Ship, and Expedition.
Mocks use MSW on the same `/api/{service}` paths, generated types/schemas, strict
unhandled-request failure, fixed clocks/IDs/delays, cross-tab state, and named
journey scenarios. `established-player` is the default mock scenario.

## 8. Phase 1 release evidence

Before completion:

- `npm run verify` passes from a clean frozen install;
- one real-stack smoke covers signup, reload restoration, Daily create/complete,
  observed Ship effect, eligible repair, Expedition launch, Profile update, and
  logout;
- no required test is made green by retry; quarantine is forbidden for
  release-critical journeys/accessibility;
- manual accessibility evidence records build, environment, tester, findings,
  keyboard journeys, one VoiceOver/Safari or NVDA/Firefox-or-Chrome smoke,
  contrast, live regions, 200% zoom, 320 px reflow, targets, and reduced motion;
- responsive checks cover 390×844, 768×1024, 1440×900, 320 px reflow, and 200%
  zoom;
- initial compressed JavaScript is at most 200 KiB gzip and no lazy route chunk
  exceeds 150 KiB gzip;
- controlled Lighthouse runs score at least 90 performance and 95 accessibility
  for representative auth and Dashboard pages.

Any Level A/AA defect that blocks a journey, hides information, or loses focus
blocks release. Budget changes require explicit reviewed rationale.
