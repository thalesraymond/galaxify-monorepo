# Galaxify frontend redesign — After hours

Status: Approved by the driving user on 2026-11-10 in
[Approve the redesign specification and implementation handoff](https://github.com/thalesraymond/galaxify-monorepo/issues/276).
Approval completes planning only; execution and merge require a separate request.

## 1. Outcome and authority

Replace the Captain's Log presentation across the existing frontend with the
approved **After hours** identity: task-first, black/charcoal, self-hosted Inter,
white primary controls, sky-blue condition data, Assembly-derived top navigation,
and a spacecraft-shaped detailed Ship hull mosaic. This is an Operate-mode app,
not a marketing page. Do not add full-screen sections, imagery or motion quotas.

Product behavior remains governed by `docs/specs/web-frontend.md`, HTTP contracts
by `docs/openapi/`, and delivery requirements by
`docs/specs/web-frontend-delivery.md`. This spec changes presentation, not game
mechanics, service contracts, state ownership or authentication policy.

Keep `apps/web-frontend/DESIGN.md` unchanged during this planning effort. The
foundation implementation ticket replaces its obsolete visual rules with this
system and records the migration scope. It then owns reusable visual rules;
this spec owns redesign scope, route acceptance and migration requirements.
Reconcile obsolete visual wording in the product spec in that same ticket
(e.g. the logbook form wording); do not change behavioral requirements.

Approved evidence, pinned rather than tracked by moving branch name:

- [Choose Galaxify's direction or define an intentional blend](https://github.com/thalesraymond/galaxify-monorepo/issues/273).
- [Test the chosen direction in a convergence prototype](https://github.com/thalesraymond/galaxify-monorepo/issues/274), commit `2e7dc37`.
- [Stress-test the new identity across the whole frontend](https://github.com/thalesraymond/galaxify-monorepo/issues/275), commit `dca3e21`; human comment: “Prototype approved.”
- [Approved source and evidence](https://github.com/thalesraymond/galaxify-monorepo/tree/dca3e21/apps/web-frontend/prototype-convergence):
  `DESIGN.md`, `BRIEF.md`, `COVERAGE.md`, `CROSS-FRONTEND-REVIEW.md`,
  implementation CSS/TSX and segmented browser captures.
- [Inherited After hours record](https://github.com/thalesraymond/galaxify-monorepo/blob/dca3e21/apps/web-frontend/prototype-identity/DESIGN.md).

The recorded prototype “approval pending” wording predates the human approval;
it is not a reason to reopen the aesthetic decision. Browser evidence establishes
only the checks actually recorded, not production certification.

## 2. Visual system and assets

Use semantic CSS custom properties in the existing CSS Modules architecture.
Map existing component roles to the new values, rather than adding a second
parallel theme. No theme toggle or alternate identity.

| Role | Target |
| --- | --- |
| Page ground | `#000000` |
| Section/field surface | `#111111` |
| Raised/disabled surface | `#252525` |
| Decorative divider | `#292929` |
| Control boundary | `#777777` |
| Primary text | `#ffffff` |
| Secondary text | `#b4b4b4` |
| Data/focus | `#65bde9` |
| Danger text/indicator | `#ff9ca5` |
| Primary action | `#ffffff` background, `#000000` text |

The divider is not sufficient as the sole boundary of an actionable control.
Validate actual text, focus and control contrast in rendered states. Danger
uses this foreground plus explicit text/confirmation; do not invent a pink
filled destructive button with untested white text. Retain accessible semantic
status distinctions without relying on color.

- Inter throughout player-facing UI, `sans-serif` fallback, locally served,
  `font-display: swap`; body 16px/1.5, supporting text/labels 14px, route heading
  24px/1.2 at weight 500 and tracking -0.025em, section heading 18px/1.3 at 500,
  row heading 16px/500, brand 20px/500. Numeric hull 30px/400;
  material/countdown figures 24px/400. Use tabular numerals and wrap long text.
- Spacing: 4/8px-based scale including 8, 12, 16, 20, 24, 32 and 40px.
  Section padding 24px desktop, 20px mobile; standard inter-panel gap 24px.
- Section corners 20px; buttons/inputs/selects pill-shaped; notices and textarea
  corners 8px; meter corners 99px. Controls at least 44×44px; separate adjacent
  targets by 8px. No gratuitous nested panels, gradients, glow or shadows.
- Buttons use 8px/14px padding. Complete is outlined; primary Save/Repair/Launch
  are white-filled. Disabled controls use raised/muted/divider roles and retain
  adjacent textual reasons. Hover feedback is fine-pointer-only; press may move
  an enabled button down 1px over 120ms. Reduced motion removes movement.
- Focus is a 3px sky-blue outline with 4px offset, never clipped or obscured.
  Forms, notices, skeletons, disclosures, errors, menus and dialogs use this one
  vocabulary, including default, hover, focus, pending, disabled and failure.

Asset inventory/provenance:

- Inter variable font and its OFL license are in the pinned prototype's
  `fonts/inter.ttf` and `fonts/inter-OFL.txt`. Retain the license and document
  source/version and any webfont subsetting/conversion; ship only required
  Inter resources, preferably optimized WOFF2 with retained glyph coverage.
- Hull and navigation mark are code-authored SVG in the pinned `main.tsx`;
  preserve the authored mark and detailed 100-cell spacecraft silhouette. Hull
  cells encode 0–100 confirmed hull: intact blue, damaged outlined. Provide
  equivalent numeric hull, accessible gauge and diagram label; cells are not
  100 keyboard targets. Compact overview geometry may follow the approved capture.
- No photographs, generated images or raster artwork are needed. Evidence PNGs
  are review assets, not application content. Do not ship Geist, Instrument Sans,
  alternative themes, lab styles or comparison fixtures.

Allowed implementation tuning is limited to verified contrast, reflow, font
delivery and native accessibility needs; document visual differences with
before/after evidence. A material aesthetic or structural departure returns to
human review, not an agent-selected redesign.

## 3. Layout, navigation and responsive behavior

- Centered 1248px maximum outer frame with 24px horizontal padding; equal edges.
  Desktop top navigation has an 88px minimum height and a bottom divider.
  Primary order: Dashboard, Dailies, Ship, Expeditions. Active text is white,
  inactive muted; active fill remains transparent. Expose `aria-current`.
- Profile and Logout remain secondary account-menu actions, not a fifth primary
  destination or an invented Profile-only sign-out journey. Preserve keyboard,
  dismissal and focus behavior from the production menu.
- At 850px and below, use a labelled Menu disclosure and compact header
  (72px baseline reservation, allowed to grow for zoom/content); 20px gutters.
  Do not retain the old sidebar or fixed bottom navigation. Escape closes the
  menu and returns focus; navigating closes it and focuses the route heading.
  Open menus must fit/scroll within the viewport without hiding focused items.
- Ship/Expedition desktop pairs use 1.4fr/1fr with a 24px gap and stack at
  1100px and below. At 640px and below, Daily rows/actions and date tools reflow;
  no clipped task facts or reduced targets. At 480px and below, Ship geometry
  sits above facts, the diagram is about 100px high, and hull numbers stay whole.
- Daily create/edit and account form surfaces are capped at 760px, matching the
  prototype account/Daily form vocabulary; the deletion dialog is at most 480px
  wide and 85dvh high with internal scroll. It must reflow at 320px and zoom.
- Page content uses ordinary document scrolling. The prototype's reserved lab
  lane, fixed app-height calculation, nested app scroller, synthetic disclosures
  and sample/variant/session URL controls do not ship.

## 4. Route and state acceptance

Keep existing route paths, feature boundaries and lazy route loading. This table
adds visual acceptance to, and does not replace, the production product spec.

| Route | Required composition and behavior |
| --- | --- |
| `/` | Existing anonymous signup / authenticated Dashboard redirect; never expose protected content during bootstrap. |
| `/signup`, `/login` | Focused labelled Inter/charcoal form; show/hide password, validation, retained non-secret input per session policy, pending/retry, existing safe return-route behavior. No marketing split panel. |
| `/dashboard` | Pending-first Today's Dailies, collapsed completed summary, then Ship/Expedition summary band. Preserve task description, due/difficulty/stakes, completion and existing edit/delete access; no date/filter management or investment form. Ship keeps eligible direct Repair and Inspect Ship; Expedition links to overview/detail as appropriate. |
| `/dailies` | Current/History local nav; date/status URL scope, Previous/Next/Today/date picker; full management rows. Create Daily stays beside the heading in every collection state. Long text wraps without clipping actions. |
| `/dailies/new`, `/dailies/:dailyId/edit` | Dedicated form at all widths; real difficulty metadata, title/description limits and timezone rules unchanged; dirty guards on internal links, Cancel, Back and unload. Save returns to the appropriate Daily date, identifies/focuses the saved row and announces success. Completed edit/delete preserve history. Missing/inaccessible ID gets local recovery. |
| `/dailies/history` | Date-grouped Completed/Missed occurrences, preserved timezone and typed material/hull effects; description disclosure, real cursor Load more and local continuation Retry. Do not copy the prototype's fixed UTC/history fixtures. |
| `/ship` | Hull first, detailed 100-cell spacecraft plus numeric gauge, confirmed materials and Repair next; level/updated time secondary. Concise repair guidance and detailed disclosure; damaged, full-hull and zero-material states. Preserve authoritative variable restoration, not the prototype's fixed repair amount. |
| `/expeditions` | Overview/History local nav; real investment/shortcuts and quote when eligible, blockers/cooldown/stale quote guidance; in flight prioritizes remaining and absolute local resolve time. Ship facts remain confirmed. Never reproduce client-calculated odds as authority. |
| `/expeditions/history` | Outcome/status and real mission facts/reward; existing limit/offset Load more with loaded-state retention on detail navigation and local retry. No synthetic page limit. |
| `/expeditions/:expeditionId` | One mission facts/timeline layout: countdown dominates in flight, confirmed Success/Failure and reward dominate when resolved. Preparation, pending result, delayed/retry, stale and missing-ID recovery remain distinct. No repeat celebration on revisit. |
| `/profile` | Existing email/member-since and username editing; separate Danger zone with password-confirmed deletion dialog. Preserve validation, retry and state purge; no invented profile fields. |
| Protected `*` | Contextual not-found with safe recovery in the application shell, without an anonymous protected-data flash. |
| Bootstrap, route loading and error boundaries | Real session outage, lazy-loading and thrown-boundary tests, not sample buttons. Shape skeletons to content; scope recovery appropriately. |
| `/__design-system-preview` | Update existing developer catalog to the new tokens/primitives and states; not a new player navigation destination and not the prototype's placeholder page. |

Applicable components/routes must cover populated, first-run/empty, initial
loading, preparing, unavailable/retry, background refresh/stale, mutation pending,
rejection/rollback, Updating, Update delayed and long-content states. Unrelated
panels and routine completion remain usable. Test actual feasible domain states,
not a Cartesian product of meaningless sample combinations.

## 5. Interaction and asynchronous invariants

Retain the full product specification's session and reconciliation contracts;
the following are mandatory regression anchors, not a replacement algorithm:

- Daily completion is immediate/optimistic and rolls back in place on rejection.
  Create/edit/delete, Profile save, repair and launch remain pessimistic.
- Ship values are last confirmed facts, not locally incremented awards or guessed
  deductions. Use the existing public Ship and downstream reconciliation seams.
- Preparing is not failure; Updating becomes Update delayed with local Retry.
  Keep per-resource status next to the affected facts/actions, not a global sync bar.
- Repair/Launch spending gates follow fresh authoritative evidence. Quote wording
  must agree with action eligibility; retained stale facts never imply readiness.
- Preserve observation baselines, freshness/expiry generations, shared query
  cache, route-change survival, hidden/offline/unobserved pauses and session purge.
  Never replay launch/repair automatically or credit rewards twice on revisit.
- History, deadlines, recurrence and result timing come from real API contracts;
  preserve local/timezone presentation and accessible non-announced countdowns.
- Preserve form drafts on recoverable errors, field-linked messages, exactly-once
  scoped announcements, focus containment/restoration, and safe return URLs with
  supported date/filter scope. Session loss must still purge sensitive drafts.

## 6. Acceptance evidence and budgets

Each implementation ticket runs from `apps/web-frontend`, using Node 24 and a
frozen `npm ci` install: `npm run format:check`, `npm run typecheck`,
`npm run lint`, `npm run build`, and changed/adjacent component/integration tests.
Shared tokens/shell/routing/fixtures/config changes run all affected suites, not
only a focused snapshot. Existing tests are preserved; adapt assertions only
where this spec intentionally changes presentation.

Before completion, `npm run verify` must pass, including coverage, API-generated
diff, production bundle guard, deterministic mock journeys, cross-browser,
accessibility, visual and performance suites. Keep existing coverage floors
(70% lines/statements/functions, 60% branches) and explicit critical scenarios.

Evidence matrix:

- Chromium route/state inventory at 1440×900, 768×1024, 390×844 and 320px reflow;
  inspect actual screenshots, long/unbroken text and 200% zoom. Add breakpoint
  checks on both sides of 1100/850/640/480px for affected layouts/navigation.
- Reviewed new goldens for each changed route and representative empty/loading/
  failure/stale/form/dialog state. Record why each old baseline changed; do not
  auto-accept a batch or loosen visual thresholds to manufacture a pass.
- WCAG 2.2 AA; automated axe plus complete keyboard journeys, contrast, live
  regions, non-color status, focus visibility, targets and reduced-motion tests.
  Manual smoke on VoiceOver/Safari or NVDA/Firefox-or-Chrome records build,
  platform/browser/assistive-tech versions, tester, findings and retest.
  If unavailable in the agent environment, this is a human release blocker.
- Firefox, WebKit and mobile WebKit cover representative signup/session restore,
  primary/mobile navigation, mutation/recovery and logout, as required today.
- Real-stack smoke: signup, reload session, Daily create/complete and observed
  Ship effect, eligible repair and readiness, launch, Profile update and logout.
  Mocks additionally cover deterministic delay, rollback, stale quote, fresh gate
  release, histories, typed results and deletion without risking a real account.
- Initial compressed JS ≤200KiB gzip, each lazy route chunk ≤150KiB gzip;
  controlled Lighthouse auth/Dashboard performance ≥90, accessibility ≥95.
  No remote font dependency, comparison runtime or unnecessary font families.

Record commands, commit, environment, result and inspected evidence. An unrun
required check is incomplete, not waived by prototype approval. Do not quarantine
release-critical tests, rely on retries for green results, suppress detectors,
or lower budgets without separately reviewed rationale. The prototype detector's
inherited font/dormant-lane warnings are disclosed historical findings, not a
production waiver or instruction to change the selected Inter face.

## 7. Migration and boundaries

Create separate execution issues under a non-Wayfinder implementation epic,
label fully specified work `ready-for-agent` even when blocked, and use native
parent/dependency relationships. Issue bodies link spec sections rather than
duplicate this spec. The implementation epic defines ownership and gates.

Implement through small reviewable changes on production main, not by merging
or cherry-picking prototype branches. Reuse production primitives/hooks and
feature APIs; port approved presentation and authored geometry deliberately.
Do not modify service code, wire contracts, auth/security logic, query keys,
observation lifecycle or gameplay formulas as part of a visual rewrite.
Any discovered prerequisite behavioral defect gets a separately scoped issue.

Shared foundations necessarily affect all routes before every route-specific
layout lands. This intermediate state is not redesign completion. Capture and
review all affected surfaces at each shared change, retain behavior tests, and
do not present the mixed migration state as the final approved UI. No feature
flag/dual theme is introduced solely for this migration.

Out of scope: backend/API changes, new mechanics, public hosting, framework or
state-library migration, marketing pages, themes, new profile data, wholesale
dependency upgrades, production prototype controls, or automatically merging PRs.

## 8. Approval boundary

The user explicitly approved the complete specification and seven-ticket
breakdown after approving the spec location, dependency-ordered slices and
production verification requirements. Publication and implementation-issue
creation are authorized; production implementation and merge are not.

The resolution on
[Approve the redesign specification and implementation handoff](https://github.com/thalesraymond/galaxify-monorepo/issues/276)
links the published artifact and actual implementation epic/tickets.
