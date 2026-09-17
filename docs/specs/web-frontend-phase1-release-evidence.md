# Phase 1 Frontend Release Evidence

Version: 1 — issue [#161](https://github.com/thalesraymond/galaxify-monorepo/issues/161), branch `161-frontend-release-gate`.

This record closes the evidence required by
[`web-frontend-delivery.md`](./web-frontend-delivery.md) §§5–8. It distinguishes
fully automated evidence from the one human-only screen-reader item that the
ticket owner explicitly accepted as a known non-blocking limitation.

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
