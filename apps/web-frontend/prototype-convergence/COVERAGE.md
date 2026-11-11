# Cross-frontend coverage — #275

Disposable, synthetic Operate-mode prototype. This extends the accepted After
hours direction; it does not change production `src/`, authorize a merge, or
certify real services. Inventory source: `../src/app/routes.tsx`. Human approval
of cross-frontend reach is **pending**. The exceptions below are disclosed, not
approved exceptions for a final specification.

## Run and reproduce

Use Node 24. From `apps/web-frontend`:

```sh
npm ci
npm run prototype:convergence:build
npm run prototype:convergence:preview
# In another terminal:
node prototype-convergence/verify-cross-frontend.mjs
PROTOTYPE_EVIDENCE_DIR=/tmp/opencode/275-core node prototype-convergence/verify-browser.mjs
```

Preview: `http://127.0.0.1:4321`. Development: `npm run prototype:convergence`
on port 4320. All dates, Player identities, outcomes, and balances are made up.
Use **made-up credentials only**; forms never send credentials or persist them.
Reload resets in-memory state. The sample control lane is separate from the app's
independently scrolling viewport; `-part-N` captures show the rest of that scroll.

## Route matrix

| Production route/boundary | Runnable prototype | States and interactions | Limits |
| --- | --- | --- | --- |
| `/` | `/`, `/?session=anonymous` | Dashboard / signup redirect | Default route exploration bypasses auth; explicit session sample models guards |
| `/dashboard` | `/dashboard` | Pending-first completion, completed disclosure, game summaries; loading/empty/error; last confirmed updates | Fixture date is January 15, 2026 |
| `/dailies` | `/dailies?sample=long` | Date/status URL scope, long title/description/unbroken text, empty/loading/error/retry, Complete/Edit/Delete | Date calculation and recurrence are not backend integration |
| `/dailies/new` | `/dailies/new?sample=error` | Native required/length validation, trimmed title check, simulated save rejection with retained draft/retry; saved-row focus | Deadlines are synthetic; no API validation proof |
| `/dailies/:dailyId/edit` | `/dailies/walk/edit` | Deep-link prefill, save; dirty links, Cancel, browser Back and unload; missing ID recovery | Native browser confirmation for dirty/delete dialogs |
| `/dailies/history` | `/dailies/history?sample=long` | Preserved Completed/Missed effects, description disclosure, long history; empty/loading/error/retry | Static synthetic outcomes, no real cursor pagination |
| `/ship` | `/ship?sample=preparing` | Damaged/full hull, repair pending/confirmed, empty balance, preparation/loading/error/retry; stale spending gate | Repair uses inherited deterministic fixture |
| `/expeditions` | `/expeditions` | Investment validation/shortcuts/quote; launch pending; confirmed balance and readiness gates; local retry | In-memory launch, no server authority |
| `/expeditions/history` | `/expeditions/history?sample=long` | Success/failure/in-flight/delayed links; empty/loading/error/retry; long note and two-to-four row Load more | Bounded fixture continuation, not API pagination |
| `/expeditions/:expeditionId` | `/expeditions/sample-success`, `sample-failure`, `sample-flight`, `sample-delayed` | Outcome/reward, launch facts, in-flight deadline, delayed result retry to success; reward waits for Ship refresh; preparation/loading/error/stale | No live clock or server result resolution; sample IDs deliberately readable |
| `/signup` | `/signup?sample=error` | Email/username/password validation; show/hide password; submitting, rejection and retry; signup creates empty local account | No real account or token created |
| `/login` | `/login?sample=error` | Email/password validation; show/hide; submitting, rejection/retry; protected return route | No credentials transmitted; no persisted session |
| `/profile` | `/profile?sample=long` | Long email; username save/rejection; loading/retry; sign-out; password-confirmed local deletion; dialog focus trap/Escape/return | Deletion clears local sample only; no real account affected |
| Protected `*` | `/unknown`, `/dailies/missing/edit`, `/expeditions/missing` | Not-found recovery, route-heading focus, keyboard/mobile navigation | Guards exercised with Session sample, not production bootstrap |
| `/__design-system-preview` | Same URL | Explicit developer-only explanation and Dashboard recovery | Intentionally not duplicated as a player journey; existing production catalog remains intact |
| Auth redirect/bootstrap | `/ship?session=anonymous`, `/dashboard?boundary=bootstrap` | Sign-in preserves destination; signed-in auth visits redirect; restoring-session presentation | Session selector defaults to route exploration for easy direct review |
| Route fallback/error boundary | `/dashboard?boundary=loading`, `/dashboard?boundary=error` | Loading/error presentation, local recovery, Dashboard escape | Presentation/state simulation, not a thrown JS exception or lazy-chunk failure test |

## State controls

**Sample controls & state → Sample state** (or `?sample=`):

- `populated`: inherited core journey and added surfaces.
- `empty`: no list rows; actual signup also yields no Dailies and a full Ship
  with zero materials, so the new-account flow is not only a cosmetic toggle.
- `loading`, `error`: list/resource loading and unavailable states; auth and
  Daily/Profile forms use rejection on submission to preserve editable input.
- `preparing`: Ship/Expedition provisioning; Dailies remain reachable.
- `stale`: last confirmed facts stay visible, Repair/Launch cannot spend until
  Retry refresh. Links and habit completion remain usable.
- `long`: long Daily text (including an unbroken string), long Daily history,
  Profile email, and bounded Expedition history continuation.

**Session sample**: route exploration (default), anonymous, or signed in.
Anonymous protected navigation goes to sign-in and returns to its destination.
Sign-out clears local progression; deletion goes to signup. These are UI seams,
not authentication/security implementations. Boundary URL samples are named
above; they intentionally wait for a reviewer-triggered recovery step.

## Verification and evidence

`verify-cross-frontend.mjs` records Node/browser versions and results in
[`evidence/cross-frontend/verification.json`](evidence/cross-frontend/verification.json).
It covers all route inventory entries (plus synthetic result/missing-ID routes)
at **320, 390, 768 and 1440px**, with reduced motion, app/document reflow checks,
automated axe checks, and interaction assertions. It tests auth deep-link return,
rejection/retry without losing input, submitting state, new account, dialog
focus wrap/Escape/return, deletion navigation, and dirty browser Back/Cancel.
The inherited `verify-browser.mjs` separately checks the core completion → award
→ repair → launch loop, management interactions, Daily states, and menu Escape.
Do not confuse its older committed evidence with this session's latest run.

New segmented screenshots are in [`evidence/cross-frontend/`](evidence/cross-frontend/):
signup, Profile, Expedition history/delayed result at desktop/320px, and narrow
long-content/preparing/stale states. They are browser captures, not generated or
shipping artwork. Automated axe is not full WCAG certification; keyboard tests
do not substitute for screen-reader/device testing or human comfort review.

The final run passed on Node v24.22.2 / Chromium 156.0.8078.4. It also verifies
new-account history consistency, date/filter preservation through authentication,
the long Daily's Edit/Save/Complete/Delete lifecycle, stale quote gating, retained
Daily rejection drafts, and delayed result reward reconciliation without a
duplicate award. Independent review scored its four material fixes resolved;
the review's scoped disposition and limits are recorded below, not upgraded to
human acceptance.

## Acceptance gate

See [CROSS-FRONTEND-REVIEW.md](CROSS-FRONTEND-REVIEW.md) for checks, independent
review, limitations and the acceptance questions. Until the user accepts this
round, **#275 stays open**, no production replacement is authorized, and none of
the limits above is recorded as an approved final-spec exception.
