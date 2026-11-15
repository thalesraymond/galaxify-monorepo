# Phase 1 Frontend Release Evidence

Version: 1 — issue [#161](https://github.com/thalesraymond/galaxify-monorepo/issues/161), branch `161-frontend-release-gate`.
Version: 2 — issue [#292](https://github.com/thalesraymond/galaxify-monorepo/issues/292) (epic [#285](https://github.com/thalesraymond/galaxify-monorepo/issues/285)), branch `feat/292-verify-after-hours-redesign`.

This record captures the Version 1 evidence closing
[`web-frontend-delivery.md`](./web-frontend-delivery.md) §§5–8 (distinguishing
fully automated evidence from the one human-only screen-reader item that the
ticket owner explicitly accepted as a known non-blocking limitation for Version 1)
and the Version 2 After hours redesign release gate (`#292`), where the
human-only native screen-reader smoke was not performed and blocks closure of `#292`.

## Environment

| Item | Value |
| --- | --- |
| OS / architecture | CachyOS (Arch Linux), x86_64 |
| Node / npm | Node `v24.14.0`, npm `11.19.1` |
| Frontend tooling | TypeScript 5.9, Vite 7.3, Vitest 5, Playwright 1.63, Lighthouse CI 0.15 |
| Browser engines | Chromium 153, Firefox 155, WebKit 26.6 |
| Clean installation | `rm -rf node_modules && npm ci` completed before the final `npm run verify` run |
| Real-stack environment | Repository supervisor attached to healthy PostgreSQL, RabbitMQ, four Go services, Daily cron, Expedition worker, and Vite proxies |

On this non-Ubuntu Linux host, Playwright WebKit additionally needed compatible
`libicu74`, `libxml2.so.2`, and `libflite1` in the local Playwright WebKit
bundle loader path. This is a local browser-runtime prerequisite, not a
repository change; see the README troubleshooting note.

## Automated release gate

Final clean-install command:

```sh
cd apps/web-frontend
rm -rf node_modules && npm ci
npm run verify
```

Result: **PASS** (exit 0).

| Gate | Evidence |
| --- | --- |
| Formatting, strict types, zero-warning lint | PASS |
| Unit / integration | 32 files, 243 tests passed |
| Coverage | statements 89.87%, branches 82.17%, functions 88.33%, lines 90.02% (floors 70/60/70/70) |
| Supervisor orchestration | PASS |
| Generated OpenAPI contract drift | PASS |
| Production build and proxy-leak inspection | PASS |
| Gzip budgets | initial JavaScript 141.1 KiB gzip / 200 KiB; 21 lazy chunks, largest 11.2 KiB gzip / 150 KiB |
| Chromium core E2E | 5 passed |
| Chromium MSW journeys | 11 passed |
| Firefox, WebKit, mobile WebKit representative journeys | 12 passed |
| Automated accessibility | 12 axe/checklist tests passed (including the 9-item checklist suite) |
| Visual regression | 7 baseline tests passed |
| Auth-route Lighthouse CI | performance 97, accessibility 100 (thresholds 90/95) |

No release-critical test used retry, quarantine, reduced threshold, or a broad
screenshot mask.

## Representative authenticated Dashboard Lighthouse

§8 requires controlled Lighthouse evidence for both a representative auth page
and Dashboard page. The CI-safe `npm run perf` covers the unauthenticated Login
route. The real-stack command below creates a fresh Player via the production
preview, reuses that persisted session for `/dashboard`, and fails at the same
90/95 thresholds:

```sh
npm run build
npm run perf:dashboard
```

Result: **PASS** — performance **96**, accessibility **100**.

During measurement, the Dashboard initially scored 72 performance due to CLS
0.692: minimal three-line panel skeletons expanded into the full Dashboard and
the main content did not reserve mobile viewport height. The fix reserves panel
space during loading and a minimum mobile main-content height. The final report
recorded CLS 0.017, FCP 1.7 s, LCP 2.7 s, TBT 10 ms, and Speed Index 1.7 s. The
fix preserves all standard auth gating and does not alter budgets.

## Real-stack smoke

Command (with the repository-owned stack running):

```sh
RUN_REAL_STACK=1 npx playwright test e2e/real-stack-smoke.spec.ts --project=chromium --reporter=list
```

Result: **PASS** — 1 test in 1.3 minutes (final post-review rerun; no product-action retries).

The journey proves, through Vite relative `/api/{service}` proxies and without
MSW: signup and downstream provisioning; reload session restoration; Daily
creation and completion; the observed +10 Ship materials event effect; a
missed-Daily hull-damage event; eligible repair (ending at hull 100/materials
5); Expedition readiness and launch (durably observed as in flight with one
material invested); Profile username update; and local logout with refresh
storage cleared. This demonstrates contracts, persistence, RabbitMQ event
propagation, and logout over the complete local stack.

## Accessibility and responsive evidence

The versioned checklist is
[`web-frontend-accessibility-checklist.md`](./web-frontend-accessibility-checklist.md).
It records the automated keyboard, contrast, live-region, 200% zoom, 320 px
reflow, touch-target, orientation, and reduced-motion outcomes; all pass.

It also records the defects found and fixed rather than masked:

- 320 px reflow overflow from implicit grid tracks and a max-content time-zone
  select;
- a 42 px skip-link target below the 44 px design floor;
- the WCAG 2.5.8 inline-link exception is scoped only to prose links, not a
  global target-size exclusion.

### Known non-blocking limitation

The required VoiceOver/Safari or NVDA/Firefox-or-Chrome manual smoke was **not
performed** because this automated environment cannot run either assistive
technology. Per the ticket owner’s explicit 2026-09-16 decision, it is a known
non-blocking limitation, documented with the human procedure and sign-off in
the checklist. This evidence must not be described as a completed manual
screen-reader smoke until a human performs and records it.

## Version 2 — After hours redesign release gate (#292)

Issues [#292](https://github.com/thalesraymond/galaxify-monorepo/issues/292) and
epic [#285](https://github.com/thalesraymond/galaxify-monorepo/issues/285),
base commit `f9339d1` + `#292` verification changes on branch
`feat/292-verify-after-hours-redesign`.

Environment: Clean `npm ci` in `apps/web-frontend` on Node `v24.22.3`, npm
`11.19.1`, Playwright `1.65.0` (`chromium-1254`, `firefox-1572`, `webkit-2388`),
`Linux 7.3.3-1-cachyos x86_64`.

### Cleanup and verification adjustments

- **Legacy token and dead-code cleanup**: removed 17 unused `--color-*` aliases
  and `--radius-panel` / `--radius-logbook` from
  `apps/web-frontend/src/shared/styles/tokens.css`, removed unused `tone` prop
  and `.on-light` rules from `PageHeader`, and removed orphaned
  `apps/web-frontend/src/features/ship/pages/ShipPage.*` plus its export in
  `src/features/ship/index.ts`.
- **Error boundary coverage and 320 px reflow fix**: added multi-route recovery
  test (`Back to Dashboard`) in `src/test/error-boundary.test.tsx`, added real
  route `AppErrorBoundary` E2E/a11y checks via shared helper
  `e2e/route-error-boundary.ts` (`e2e/smoke.spec.ts` and `e2e/a11y.spec.ts` at
  `1440×900` and `320×700`, aborting `**/src/app/pages/ShipPage.tsx*` once),
  and fixed `320×700` horizontal overflow in `AppErrorBoundary.module.css`
  (**before**: unbroken module URLs overflowed `scrollWidth > innerWidth`;
  **after**: `min-width: 0; overflow-wrap: anywhere` on `.error` and
  `overflow-wrap: anywhere` on `.description`, `0 px` horizontal overflow).
- **Authenticated Dashboard & `/login` Lighthouse recovery (`0.84 -> 0.95` and
  `0.90 -> 0.98`)**: subsetted
  `apps/web-frontend/src/shared/styles/fonts/inter.woff2` with `pyftsubset`
  (`350,352 B -> 67,792 B` source / `67.79 kB` built; preserving `opsz`
  `14..32` and `wght` `100..900` variable axes, `450` glyphs, `290` codepoints,
  and `kern,liga,clig,calt,tnum,locl,ccmp,mark,mkmk` features) and adjusted
  `DashboardDailiesPanel.module.css` `.loading` `min-height` (`18rem -> 8.75rem`)
  to match the `<EmptyState embedded>` panel height and stop
  `<aside aria-label="Ship and Expedition status">` from shifting.
  **Before**: Dashboard `performance 0.84`, Slow 4G LCP `4.4 s`, `CLS 0.070`;
  `/login` `performance 0.90`, LCP `3.6 s`. **After**: Dashboard `performance 0.95`,
  Slow 4G LCP `2.9 s`, `CLS 0`; `/login` `performance 0.98`, LCP `2.3 s`.
- **Real-stack E2E, `640px` breakpoint, and visual baseline alignment**:
  updated `e2e/real-stack-smoke.spec.ts` to drop removed `Due date`/`Due time`
  form inputs (removed in `#207`), inject `due_local_date`/`due_local_time` on
  `POST /api/daily/dailies` via `page.route` for the bounded missed-Daily check,
  and target `page.getByRole('region', { name: 'Materials' })`. Added `641`/`640` px
  Daily row reflow checks in `e2e/dailies-layout.spec.ts`. Refreshed
  `e2e/route-widths.spec.ts-snapshots/ship-reflow-chromium-linux.png` (**before**:
  `320×1091` with `"Launch an Expedition"`; **after**: `320×1031` from `#291`
  shortening the `DashboardExpeditionPanel` label to `"Plan Expedition"`).

### Inspected visual and breakpoint inventory

- Visual golden baselines and responsive geometry suites (`npm run test:visual`):
  `visual.spec.ts` (`dashboard-shell-*`, `design-system-states-*`,
  `design-system-dialog-*`), `route-widths.spec.ts`,
  `dashboard-presentation.spec.ts`, `dailies-layout.spec.ts`,
  `expedition-presentation.spec.ts`, `account-presentation.spec.ts`, and
  `navigation-disclosures.spec.ts`.
- Widths & states covered: `1440×900` desktop, `768×1024` tablet, `390×844`
  mobile, `320×700` reflow, `720×450` (200% zoom), and breakpoint boundaries
  `479/480/481`, `639/640/641` (including `DailyRow` `641/640` px reflow),
  `849/850/851`, and `1099/1100/1101` across populated, empty, loading,
  unavailable/retry, stale, dialog, and long unbroken text states.

### Automated verification results

1. **`npm run verify` (exit `0`)**:
   - `format:check`, `typecheck`, `lint`: passed.
   - `test:coverage`: `43` test files, `426` tests passed (`92.45%` statements,
     `87.14%` branches, `91.92%` functions, `92.67%` lines).
   - `test:orchestration`: `6` tests, `6` pass, `0` fail, `0` skipped.
   - `api:check`: exit `0` (`npm run api:generate && git diff --exit-code -- src/api/generated`).
   - `build` & `bundle:check`: `dist/assets/inter-BcW4E7NE.woff2` `67.79 kB`; no
     proxy configuration or proxy target values in production bundle; initial
     JavaScript `120.4 KiB` gzip (budget `200.0 KiB`); `8` lazy route chunks,
     largest `PageHeader-ChRQi2Dt.js` at `35.9 KiB` gzip (budget `150.0 KiB` each).
   - `test:e2e`: `8 passed (12.5s)`.
   - `test:e2e:mock`: `19 passed (18.7s)`.
   - `test:cross-browser` (`firefox`, `webkit`, `mobile-webkit`): `15 passed (28.2s)`.
   - `test:a11y` (`a11y.spec.ts`, `a11y-checklist.spec.ts`, `support-panels.spec.ts`): `29 passed (20.8s)`.
   - `test:visual`: `130 passed (57.8s)`.
   - `perf` (`/login`): `performance: 0.98`, `accessibility: 1`, `best-practices: 0.96`,
     `seo: 0.91` (`fcp: '0.9 s'`, `lcp: '2.3 s'`, `tbt: '20 ms'`, `cls: '0'`, `si: '0.9 s'`).
2. **`npm run perf:dashboard` (exit `0`)**:
   - `Dashboard Lighthouse: performance 0.95, accessibility 1` (`first-contentful-paint 0.9 s`,
     `largest-contentful-paint 2.9 s`, `total-blocking-time 20 ms`, `cumulative-layout-shift 0`,
     `speed-index 0.9 s`, `interactive 2.9 s`).
3. **Real full-stack smoke (`RUN_REAL_STACK=1 npx playwright test e2e/real-stack-smoke.spec.ts --project=chromium --reporter=list`)**:
   - `1 passed (1.1m)` against `CRON_INTERVAL=15s make dev`.

### Human-only gate blocking `#292` closure

The native screen-reader smoke (VoiceOver/Safari or NVDA/Firefox-or-Chrome)
across the After hours redesign was **not performed** in this automated
environment. Per `#292`, automated verification is complete, but `#292` must
remain open until a human tester performs and records the screen-reader smoke in
[`web-frontend-accessibility-checklist.md`](./web-frontend-accessibility-checklist.md).
