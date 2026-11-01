---
type: problem
created: 2026-11-01
updated: 2026-11-01
sources:
  - "galaxify-monorepo@dfb2577db9d07c3f3dd0cf6340c3f0ff8df6923d"
---

# Playwright install and lockfile mismatch

On 2026-11-01 at the reviewed SHA, installed `@playwright/test`, `playwright`,
and `playwright-core` were 1.63.0 while the lockfile specified 1.64.1 for all
three. Browser revisions are tied to the installed Playwright version, so a
cache containing Firefox 1555 and WebKit 2370 does not satisfy an older
installation requesting Firefox 1543 and WebKit 2359. Do not infer that a
browser is missing without checking the requested revision.

The remedy for stale dependencies is the documented `make frontend-install`
(`npm ci`), using the project's Node and npm toolchain; do not change the lock
or refresh snapshots to mask a mismatch. On 2026-11-01, Node 24.19.0 and npm
11.19.1 installed locked Playwright 1.64.1, which requests Firefox 1555 and
WebKit 2370. The subsequent full `npm run verify` passed through both Chromium
smoke gates; all five Firefox cross-browser tests passed. The first failing gate
was cross-browser: WebKit and mobile WebKit failed to launch because Playwright
reported missing host libraries (`libicu74`, `libxml2`, `libflite1`), not a
missing browser revision. The remaining a11y, visual, and perf gates did not
run. Playwright suggested `npx playwright install-deps`; use an appropriate
host-specific dependency installation before rerunning the complete gate.
