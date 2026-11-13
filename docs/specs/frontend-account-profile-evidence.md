# Account Forms and Profile — Implementation Evidence

Issue
[#287](https://github.com/thalesraymond/galaxify-monorepo/issues/287) "Restyle
account forms and Profile", branch `feat/287-account-profile`, base `50ed28b`
(foundation delivery
[#286](https://github.com/thalesraymond/galaxify-monorepo/issues/286)
"Establish After hours foundations and responsive navigation").

This record is scoped to the account surface: Signup, Login, Profile, and the
account-deletion dialog. It implements the governing redesign specification
`docs/specs/frontend-redesign.md` (approved at commit `dbbaa9b9`; the file is
not present on the working base) for these routes:

- [§2 Visual system and assets](https://github.com/thalesraymond/galaxify-monorepo/blob/dbbaa9b9/docs/specs/frontend-redesign.md#2-visual-system-and-assets)
- [§3 Layout, navigation and responsive behavior](https://github.com/thalesraymond/galaxify-monorepo/blob/dbbaa9b9/docs/specs/frontend-redesign.md#3-layout-navigation-and-responsive-behavior)
- [§4 Route and state acceptance](https://github.com/thalesraymond/galaxify-monorepo/blob/dbbaa9b9/docs/specs/frontend-redesign.md#4-route-and-state-acceptance)
- [§5 Interaction and asynchronous invariants](https://github.com/thalesraymond/galaxify-monorepo/blob/dbbaa9b9/docs/specs/frontend-redesign.md#5-interaction-and-asynchronous-invariants)
- [§6 Acceptance evidence and budgets](https://github.com/thalesraymond/galaxify-monorepo/blob/dbbaa9b9/docs/specs/frontend-redesign.md#6-acceptance-evidence-and-budgets)

on top of the product spec
[`web-frontend.md`](./web-frontend.md)
[§4 Session lifecycle](https://github.com/thalesraymond/galaxify-monorepo/blob/main/docs/specs/web-frontend.md#4-session-lifecycle),
[§5.1 Signup and login](https://github.com/thalesraymond/galaxify-monorepo/blob/main/docs/specs/web-frontend.md#51-signup-and-login)
and
[§5.8 Profile and account actions](https://github.com/thalesraymond/galaxify-monorepo/blob/main/docs/specs/web-frontend.md#58-profile-and-account-actions),
and the pinned convergence prototype at `dca3e21`
([`AccountSamples.tsx`](https://github.com/thalesraymond/galaxify-monorepo/blob/dca3e21/apps/web-frontend/prototype-convergence/AccountSamples.tsx),
[`prototype.module.css`](https://github.com/thalesraymond/galaxify-monorepo/blob/dca3e21/apps/web-frontend/prototype-convergence/prototype.module.css)
— `.detailWork` 1.4fr/1fr grid, `.dailyForm` 760px account-form cap). Pinned
reference captures:
[signup-320](https://github.com/thalesraymond/galaxify-monorepo/blob/dca3e21/apps/web-frontend/prototype-convergence/evidence/cross-frontend/signup-320.png),
[profile-1440](https://github.com/thalesraymond/galaxify-monorepo/blob/dca3e21/apps/web-frontend/prototype-convergence/evidence/cross-frontend/profile-1440.png),
[profile-dialog-320](https://github.com/thalesraymond/galaxify-monorepo/blob/dca3e21/apps/web-frontend/prototype-convergence/evidence/cross-frontend/profile-dialog-320.png).

No behavior contract changes: real session, transport, forms APIs, and the
auth session/storage manager are untouched.

## Environment

| Item | Value |
| --- | --- |
| Node / npm | Node `v24.22.3`, npm `11.19.1` (isolated Node 24 toolchain outside the repository; the system Node was outside engines `^24.0.0`) |
| Install | `npm ci` — exit 0; pre-existing audit and skipped-postinstall warnings only (log: `npm-ci.log`) |
| Browser | Playwright 1.65.0, Chromium (headless) |
| Lane config | temporary `playwright.issue-287.config.ts` — mock port 4274, outage port 4275, avoiding the stock 4174/4175 shared with other worktrees; archived outside the repo, **not committed** |

Logs, inspected screenshots, old baselines, and old-vs-new contact sheets were
captured to a persistent evidence directory outside the repository; artifact
names referenced below (`*.log`, `screenshots/`, `baselines-old/`,
`contact-sheets/`, `impeccable-detect.json`) are files in that directory.

## Presentation changes delivered

### Auth shell and forms (frontend-redesign §3)

- `AuthShell` main is now transparent with `padding: 0` and a 760px bound; the
  charcoal surface moved onto the form itself so the route heading and
  description sit above the panel on the page ground (pinned `signup-320`,
  `signup-1440`). Header/brand/navigation behavior unchanged.
- Form panel: `var(--color-surface)` background, `var(--radius-section)`
  radius, 24px desktop / 20px mobile padding, 24px field gaps (semantic tokens
  only — no hex literals, no new theme aliases).
- Signup description updated to "Complete Dailies and keep your Ship flying."
  (obsolete "Start your logbook" removed); `SessionNotice` renders inside the
  panel.
- Primary submit keeps intrinsic width; the cross-link sits below it with
  ≥8px separation and a ≥44px target.

### Password visibility toggle (frontend-redesign §2)

- `PasswordField` now composes the shared `Button` (`variant="secondary"`)
  instead of a bespoke button: it inherits the 44px target and the shared
  3px sky focus ring at 4px offset; the legacy local toggle styles and the
  incorrect bespoke focus outline are removed.
- `aria-pressed`, show/hide value preservation, and forwarded React Hook Form
  ref/props are unchanged. No toggle was added to the deletion dialog.

### Profile (frontend-redesign §3)

- Page spans the available frame; `PageHeader` then a `.sections` grid
  `minmax(0, 1.4fr) minmax(0, 1fr)`, 24px gap, `align-items: start`, stacking
  at ≤850px. Identity and Danger zone remain `ContentSurface` instances.
- Identity labels are sentence case, 14px/500 muted; values 16px normal.
  `min-width: 0` on grid children and `overflow-wrap: anywhere` on the email
  value so a long unbroken address wraps without horizontal overflow.
- Deletion dialog actions `flex-wrap` with 8px gap (fit at 320px); the
  deletion field carries `autoComplete="current-password"`. Shared `Dialog`
  (focus trap, Escape, return focus) is unmodified.

### Behavior fix found while testing

- The shared `Dialog` focuses its own first control on mount (and React
  StrictMode replays passive effects in dev), so the "password receives focus
  on open / after failed deletion" contract did not hold in a real browser
  even though jsdom tests passed. `ProfilePage` now schedules the password
  focus with `queueMicrotask` inside the existing `deleteOpen` effect so it
  lands after the dialog's mount pass. Verified as actual focus in Chromium,
  not inference.

## Tests added / adjusted

1. `src/features/profile/pages/ProfilePage.test.tsx` — **2 new tests** at the
   routed-page seam with HTTP-boundary mocks, plus an
   `autocomplete="current-password"` assertion on the deletion field:
   - username server rejection retains the draft, then succeeds on retry;
   - deletion with a mocked 401 wrong-password keeps the password value and
     the dialog open, shows the error, refocuses the password field, and the
     retry lands on Signup with the stored session cleared.
2. `src/features/auth/pages/authPages.test.tsx` — asserts the route heading
   renders outside the form panel and the new signup description is present;
   existing pending/error/lifecycle coverage kept.
3. `e2e/auth.spec.ts` — added: safe deep link
   `/dailies?date=2026-01-15&status=PENDING` preserves the complete query
   through sign-in (query keys verified against production usage); and
   authenticated visits to `/signup`/`/login` redirect to the Dashboard.
4. `e2e/account-presentation.spec.ts` (new, wired into `test:visual`) —
   browser-observed checks at 1440/768/390/320: heading above the charcoal
   panel, panel ≤760px and surface `rgb(17, 17, 17)`, intrinsic submit,
   ≥44px cross-link/toggle targets, shared 3px/4px `rgb(101, 189, 233)`
   focus ring, show/hide password roundtrip preserving the value and
   `aria-pressed` on both signup and login, no horizontal overflow; Profile
   side-by-side ≥851px vs stacked ≤850px; long-email wrap via fetch
   interception of `GET /api/user/users/me` preserving the response schema
   (the established `cross-browser.spec.ts` interception pattern);
   deletion dialog at 320px / 400px-tall viewport with a 30-character
   unbroken username — the `[role="dialog"]` element itself overflows
   (`scrollHeight > clientHeight`, `overflow-y: auto`, height ≤ 85dvh),
   controls reachable by internal scroll, Tab and Shift+Tab stay inside,
   Escape returns focus to the trigger, mocked-401 failure refocuses the
   password, retry completes deletion.
5. `e2e/route-widths.spec.ts` — identity-width assertion updated from ≤480px
   to >480px to reflect the intentional 1.4fr identity track; Daily/Ship
   width budgets untouched. `e2e/cross-browser.spec.ts` needed no change —
   its dialog keyboard gap is now covered by the account-presentation spec.

## Results

All commands run from `apps/web-frontend` with the Node 24 toolchain; every
Playwright suite used the temporary lane config
(`--config playwright.issue-287.config.ts`, mock port 4274, outage port 4275).
The lane file is an exact copy of the stock `playwright.config.ts` with
ports 4174→4274 and 4175→4275 — reproduce any run by copying the stock
config and substituting those two ports; the archived copy lives in the
evidence directory and was deliberately not committed.

```sh
npm run format:check
npm run typecheck
npm run lint
npm run build
npm run test
npm run test:e2e:mock -- --config playwright.issue-287.config.ts
npm run test:visual -- --config playwright.issue-287.config.ts
npm run test:a11y -- --config playwright.issue-287.config.ts
npm run test:cross-browser -- --config playwright.issue-287.config.ts
```

| Check | Result | Log |
| --- | --- | --- |
| `npm run format:check` | pass | `gate-format.log` |
| `npm run typecheck` | pass | `gate-typecheck.log` |
| `npm run lint` (`--max-warnings 0`) | pass, 0 problems | `gate-lint.log` |
| `npm run build` | pass | `gate-build.log` |
| `npm run test` (full Vitest) | 43 files, 388/388 tests passed | `gate-test.log` |
| `npm run test:e2e:mock` | 19/19 passed | `gate-e2e-mock.log` |
| `npm run test:visual` | 51/51 passed | `gate-visual.log` |
| `npm run test:a11y` | 28/28 passed | `gate-a11y.log` |
| `npm run test:cross-browser` | 15/15 passed — 5 journeys × Firefox, WebKit, mobile WebKit (Chromium coverage comes from the suites above) | `gate-cross-browser.log` |
| `impeccable detect --json` on `src/features/auth`, `src/features/profile`, `src/app/shell` | clean `[]` | `impeccable-detect.json` |

`npm run verify` (coverage floors, generated-API drift, bundle guard,
perf/Lighthouse) is a release-gate command, not part of this ticket's scope;
it was not run. Manual screen-reader verification (VoiceOver/NVDA per
frontend-redesign §6) is unavailable in the agent environment and remains a
human release blocker — no automated evidence substitutes for it.

Environment note: WebKit on this non-Ubuntu host needed the documented
compat libraries (`libicu74`, `libxml2` soname `.so.2`, `libflite1`), supplied
into the Playwright WebKit bundle's `sys/lib` directory per the README
troubleshooting note — a local browser-runtime prerequisite, not a
repository change.

### Golden review (frontend-redesign §6)

Ten `e2e/route-widths.spec.ts-snapshots/profile-*.png` goldens regenerated —
the five main-page captures (desktop, tablet, mobile, reflow, zoom) and the
five `profile-dialog-*` captures — because the Profile layout intentionally
changed to the full-frame two-track grid. Actual captures were inspected
before acceptance: desktop shows Identity/Danger side by side with the wider
identity track; ≤850px shows the stacked order. The dialog goldens
additionally needed regeneration because the dimmed underlying page retained
the pre-change labels inside the suite's 2% `maxDiffPixelRatio` tolerance —
the stale background was found by image inspection, not by the comparator.
No auth-route or Daily/Ship goldens changed. Nine new `account-presentation`
goldens were created on first run and inspected. Thresholds, masks and retry
settings are unchanged.

One anomaly is recorded honestly: on one earlier route-widths run a stale
capture (old layout) was observed while sibling viewports showed the new
layout. The lane's dev server was restarted and all affected captures were
regenerated from the refreshed lane; the root cause of the stale serve is
unconfirmed. Old baselines are preserved under `baselines-old/` and
old-vs-new contact sheets under `contact-sheets/` for review.

## Lane cleanup before commit

- `playwright.issue-287.config.ts` was temporary lane infrastructure; it is
  archived in the evidence directory and removed from the worktree — nothing
  lane-specific is committed. A temporary `tsconfig.node.json` include entry
  added so `eslint`'s `projectService` could parse it was reverted to the
  exact original include list; `git diff` on that file is now empty.
- After the cleanup, `npm run format:check`, `npm run typecheck` and
  `npm run lint` were re-run and pass (`gate-format.log`,
  `gate-typecheck.log`, `gate-lint.log` reflect the final tree); source,
  tests and goldens were unchanged so the gate results above stand.
