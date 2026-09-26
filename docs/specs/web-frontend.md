# Web Frontend Specification — Phase 1

This document is the canonical product, interaction, and application-architecture
specification for Galaxify's Phase 1 React frontend. The visual system is owned by
[`apps/web-frontend/DESIGN.md`](../../apps/web-frontend/DESIGN.md), delivery and
verification are owned by
[`web-frontend-delivery.md`](./web-frontend-delivery.md), and service wire
contracts will be owned by the OpenAPI documents under `docs/openapi/`.

The closed tickets under
[Wayfinder: Complete Galaxify as a React product](https://github.com/thalesraymond/galaxify-monorepo/issues/129)
record rationale. If issue prose drifts from this document, this document is the
product authority.

## 1. Scope and product language

The frontend makes the complete Phase 1 player loop usable:

1. a **Player** signs up or signs in;
2. the Player completes recurring **Dailies**;
3. Daily outcomes change the Player's **Ship**;
4. the Player repairs the Ship and invests materials in an **Expedition**;
5. the Player follows the Expedition until it resolves.

Use the canonical nouns Player, Daily, Ship, and Expedition in navigation and
controls. Captain/log/flight language may support those labels but must not
replace them.

The frontend is desktop-first and fully usable on mobile. It supports real local
services and deterministic mocks. Public hosting, architecture visualization,
demo accounts, Ship customization, achievements, notifications, and new profile
fields are out of scope.

## 2. Routes and information architecture

| Route | Responsibility |
| --- | --- |
| `/` | Redirect authenticated Players to `/dashboard` and anonymous visitors to `/signup`. |
| `/signup` | Create an account in the authentication shell. |
| `/login` | Authenticate a returning Player. |
| `/dashboard` | Cross-loop cockpit for today's Dailies, Ship, and Expedition. |
| `/dailies` | Current recurring Dailies and date/status controls. |
| `/dailies/new` | Dedicated Daily creation page. |
| `/dailies/:dailyId/edit` | Dedicated Daily editing page. |
| `/dailies/history` | Archived Daily outcomes. |
| `/ship` | Singleton Ship status and repair. |
| `/expeditions` | Launch eligibility or current Expedition. |
| `/expeditions/history` | Past Expeditions. |
| `/expeditions/:expeditionId` | Durable current or past Expedition detail. |
| `/profile` | Identity editing and account deletion. |
| `*` | Contextual not-found state in the appropriate shell. |

Primary navigation is always Dashboard, Dailies, Ship, Expeditions. Profile and
Logout are secondary account-menu actions. Dailies owns Current/History local
navigation; Expeditions owns Overview/History local navigation. There is no
read-only Daily detail route and no Ship history route.

Unknown or inaccessible Daily edit IDs and Expedition detail IDs render a
domain-specific recovery state inside the application shell. They do not
silently redirect.

## 3. Global application behavior

### 3.1 State ownership

- React owns rendering and local component state.
- React Router owns navigation and shareable URL state.
- TanStack Query owns server data, caching, retries, invalidation, and request
  lifecycle state.
- React Hook Form owns form editing and submission state.
- Zod validates environment values, persisted browser values, forms, and API
  responses at their trust boundaries.
- React Context is limited to stable app-wide dependencies and session access.

Do not copy server state into Context or introduce Redux/Zustand without a
demonstrated problem that URL, query, context, or local state cannot solve.

### 3.2 Loading, absence, and failure

- Initial reads show route- or section-shaped skeletons, never blank pages or a
  generic centered spinner.
- Refetches retain the last confirmed value and show subtle refresh feedback.
- Initial section failures replace only that section with an unavailable state
  and Retry.
- Refresh failures retain stale data, label it unavailable/stale, and offer
  Retry.
- Legitimate empty collections explain the state and offer the relevant next
  action.
- An asynchronously missing prerequisite is `Preparing…`, not empty or failed.
- Bounded downstream reconciliation uses `Updating…`; expiry uses
  `Update delayed` and a local Retry.
- Status is adjacent to the affected value or action. There is no global sync
  indicator.

Safe transient reads may retry with bounded backoff. Mutations are not
automatically replayed. Poll only visible queries and pause reconciliation while
the tab is hidden or offline.

### 3.3 Mutation policy

Daily completion is the only optimistic domain mutation. It immediately marks
the Daily completed and disables its completion control. Failure restores the
row in place and exposes an associated Retry. An already-completed response
refetches and settles as completed.

Daily create/edit/delete, profile changes, Ship repair, and Expedition launch
are pessimistic. Disable only the initiating action, preserve input, and leave
unrelated navigation/actions available. Toasts are reserved for outcomes that
would otherwise be invisible.

### 3.4 Eventual consistency

A successful command is authoritative only for the accepting service. Never
issue compensating browser writes to imitate event consumers.

After success, update or invalidate the authoritative query and invalidate
known dependent queries. Reconcile visible downstream resources immediately and
after approximately 1, 2, 4, and 8 seconds. Stop when the expected change is
observed. Expiry is a delayed update, not command failure.

- Signup permits a partial Dashboard while Ship, Daily player state, and
  Expedition Ship state provision for up to about 30 active seconds.
- Daily completion confirms its typed material award, then reconciles Ship.
  Gate actions depending on that balance while it updates.
- Ship repair confirms Ship immediately, then reconciles Expedition readiness.
- Expedition launch confirms the Expedition, then reconciles Ship deduction.
- Expedition resolution confirms its result, then reconciles Ship reward.

The browser cannot prove when Expedition's private Ship cache has consumed an
event. End the visible sync boundary when authoritative Ship state changes. A
subsequent stale-cache launch rejection becomes a player-initiated retry state,
not an automatic launch replay.

## 4. Session lifecycle

Expose four session states: `bootstrapping`, `authenticated`, `anonymous`, and
`temporarily unavailable`. Protected content must not render until bootstrap
resolves and must never flash stale private data.

### 4.1 Tokens

- Keep the access token in memory only.
- Persist only the opaque refresh token in one versioned localStorage key.
- Never place tokens in URLs, logs, analytics, errors, query data, or other
  persisted state.
- Signup/login replaces the prior browser session, clears prior private cache,
  seeds returned Player data, and enters the app.

### 4.2 Rotation and tabs

Refresh tokens are single-use. Serialize rotation across tabs with a named Web
Lock, re-reading the persisted token after acquiring the lock. Broadcast token
replacement and terminal clearing with BroadcastChannel; the storage event is
the durable synchronization signal. Concurrent callers in one tab share one
in-flight refresh promise.

Rotate on startup, before authenticated work when access-token expiry is within
60 seconds, and near expiry while the page is visible and the Player was
recently active. Idle tabs do not keep extending the session.

Only `AUTH_INVALID_TOKEN` from a bearer-protected request may trigger one refresh
and one replay. Signup, login, logout, refresh itself, ordinary network failures,
and other 401 codes never enter this retry path.

Terminal refresh invalidity clears session, Player identity, private cache, and
sensitive drafts in every tab; routes to login; and shows “Your session ended.
Sign in again.” Preserve only a validated same-origin GET-like return route.

Network, timeout, 5xx, and auth-key infrastructure failures retain the refresh
token and enter `temporarily unavailable` with Retry/offline guidance. They do
not expose cached protected content.

Logout attempts family revocation and then clears local state regardless of the
response. If revocation cannot be confirmed, local logout still completes and
the UI describes server revocation truthfully. Account deletion requires the
current password; success purges state and routes to signup without a separate
logout call.

## 5. Screen requirements

### 5.1 Signup and login

Use a focused logbook form with concise product copy and a cross-link—no
marketing split panel.

- Signup: email, username, password; username 3–30 characters; password at least
  8 characters; normalized email.
- Login: email and password with a generic invalid-credentials message.
- Both: visible labels, show/hide password, inline field errors, one pending
  submit control, preserved values on failure, and redirect authenticated visits
  to Dashboard.
- Temporary bootstrap/refresh failure shows Retry without clearing the stored
  refresh token.

### 5.2 Dashboard

Render this fixed priority:

1. **Today's Dailies** dominate. Pending Dailies are ordered by local due time;
   completed Dailies appear in a compact/collapsible section. Rows show title,
   concise description, due-time context, difficulty/stakes, status, completion,
   and edit/delete access.
2. **Ship** shows hull gauge/number, materials, secondary level metadata,
   updating/stale status, and direct eligible Repair.
3. **Expedition** shows active progress or a route to launch, never the full
   investment form.
4. A restrained trace may connect Dailies → Ship → Expeditions.

An empty Daily day remains first and offers Create Daily. Provisioning and
failures replace only affected panels.

### 5.3 Current Dailies and forms

`/dailies` defaults to the Player's browser-local date. Date and non-default
status are URL search state. Offer previous/next day, Today, accessible date
picker, and All/Pending/Completed filters. Missed outcomes belong in History.

Creation and editing are dedicated pages at all widths. Fields are title,
optional description, and difficulty. The creation request silently includes
the browser's IANA time zone; the backend calculates today's deadline. Editing
does not alter the schedule. Title max is 120 and description max is 1000.
Difficulty options show backend-provided reward and missed-damage metadata.

Dirty forms warn before internal navigation or unload. Save returns to the
Daily's local date, identifies/focuses the changed row, and announces success.
Editing a completed Daily explains that recurrence changes going forward while
history stays unchanged.

Delete confirmation names the Daily and explains that recurrence is removed
while history remains. Failure preserves the row and restores sensible focus.

### 5.4 Daily History

Use stable descending cursor pagination and explicit Load more. Group outcomes
by occurrence date in the Daily's preserved timezone. Show title, Completed or
Missed, difficulty, due time, completion/miss time, and typed effects. Description
is collapsed behind a labelled disclosure. Continuation failure leaves loaded
groups visible and makes Retry local.

### 5.5 Ship

Order hull condition first, then materials and repair eligibility, with level
and last-updated time secondary. Show hull numerically out of 100 and through an
accessible gauge. Explain that repair spends up to the deficit/available balance
and each material restores a variable amount. Repair is one direct pessimistic
action without a confirmation modal. Full-hull and zero-material states explain
why it is unavailable and point to Dailies where relevant.

### 5.6 Expedition overview

When no Expedition is current, show a numeric material input, Min/25%/50%/Max
shortcuts, exact balance, live quote, projected balance, whole-percent success
chance, eligibility/blocker, cooldown where relevant, and estimated resolve
window. Launch is one explicit action and always revalidates authoritative state.

When in flight, prioritize accessible remaining time and absolute local resolve
time, then investment, success chance, launch time, status, and detail/history
links. Do not announce countdown ticks. At resolution, use bounded reconciliation
before showing the result.

Conflicts refresh facts and require Player-initiated retry. Launch is never
automatically replayed.

### 5.7 Expedition history and detail

History uses explicit Load more with the existing limit/offset contract and
preserves loaded state across detail navigation. Rows show outcome/status,
investment, chance, launch/resolution times, and typed material reward.

Detail uses one mission-facts/timeline layout. Countdown dominates in flight;
Success/Failure and typed reward dominate after resolution. Celebrate only a
newly observed result, not revisits.

### 5.8 Profile and account actions

Profile contains read-only email/member-since, editable username, and a separate
Danger zone. Do not invent avatar, biography, device list, or other identity
fields. Username errors remain inline. Account deletion is a password-confirmed
destructive dialog with focus restoration on failure. Logout remains in the
account menu.

## 6. Frontend architecture

Use React with strict TypeScript, Vite, React Router, TanStack Query, React Hook
Form, and Zod. Organize code feature-first around `auth`, `profile`, `dailies`,
`ship`, and `expeditions`; an `app` layer owns startup/providers/routes.

- Routes coordinate journeys; feature components express domain behavior;
  hooks orchestrate state; API/schema modules contain no React.
- Each feature has a narrow public entry point. ESLint forbids cross-feature
  deep imports.
- Move code to shared only when domain-neutral and used by multiple features.
- Use `@/` rooted at `src`; prefer relative imports inside a feature.
- Use CSS Modules and global semantic custom-property tokens.
- Avoid utility CSS frameworks and broad component suites. Accessible headless
  primitives are allowed for genuinely complex interactions.
- Generate wire types and Zod schemas only. Do not generate components, clients,
  TanStack hooks, or feature state.

Strict TypeScript includes `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`,
`useUnknownInCatchVariables`, `verbatimModuleSyntax`, `isolatedModules`, and
`noEmit`.

ESLint uses flat config with type-aware TypeScript, React Hooks, accessibility,
test, and feature-boundary rules. Checks allow no warnings. Prettier owns
formatting. npm and a committed lockfile/package-manager version own dependency
reproducibility.

## 7. Service integration contract

The browser calls relative URLs only:

| Browser prefix | Local target |
| --- | --- |
| `/api/user` | User Service, default `localhost:8081` |
| `/api/daily` | Daily Service, default `localhost:8082` |
| `/api/ship` | Ship Service, default `localhost:8083` |
| `/api/expedition` | Expedition Service, default `localhost:8084` |

Vite rewrites prefixes in real mode. Feature code never knows ports or origins.
Do not add a backend-for-frontend.

A domain-neutral transport owns URL construction, JSON/no-content handling,
auth headers, abort signals, schema parsing, and error normalization. Feature
adapters own operations, query keys, invalidation, and thin UI-oriented mapping.

Normalize network failure, abort, invalid response, and HTTP API error as a
discriminated model. HTTP errors retain status, backend code/message, optional
field errors, and `X-Request-Id`. Branch on error code, not status alone.
`EXPEDITION_NOT_FOUND` from current means a typed `none`; post-signup Ship absence
and service-specific readiness failures are typed provisioning outcomes.

### 7.1 Required contract changes

The first OpenAPI/conformance implementation ticket must describe all existing
operations and these locked Phase 1 changes. Frontend code must not duplicate
their backend rules.

**User Service**

- Make refresh-token consume/replace atomic and concurrency-safe.
- Preserve database/infrastructure failures as retryable server failures rather
  than `AUTH_INVALID_TOKEN`.
- Add idempotent `POST /auth/logout` accepting `refresh_token`, requiring no
  access token, revoking only its token family, and returning 204.

**Daily Service**

- Permit edit/delete after today's completion while preserving history.
- Add IANA `time_zone`; accept local deadline plus zone; advance recurrence by
  local calendar day across DST; retain the configured zone until edited.
- Query current Dailies by explicit RFC3339 `from`/`to` instants.
- Add `GET /dailies/difficulties` with typed reward and damage metadata.
- Enforce title 120 and description 1000 limits.
- Return typed awarded-material effect from Daily completion.
- Return service-specific retryable not-ready error while player state provisions.
- Replace unbounded history with stable descending cursor pagination returning
  items and optional next cursor.

**Expedition Service**

- Add authenticated `GET /expeditions/quote?materials_invested=<n>` returning
  normalized investment, projected balance, chance, eligibility/blocker,
  cooldown timing, and estimated resolve window.
- Replace arbitrary `reward_summary` JSON with typed material reward for Success
  and Failure.
- Return a service-specific retryable not-ready error while Ship state provisions.

Ship absence after signup remains a typed provisioning outcome. Existing Ship
status/repair operations otherwise remain the Phase 1 wire contract.

## 8. Shared component boundary

Reusable domain-neutral components may include shells/navigation, skip link,
page header, local tabs, content surface, buttons, labelled controls, field/form
errors, gauge/progress, status badge, definition stats, skeleton, empty state,
unavailable/stale/delayed panel, scoped live region, disclosure, menu, dialog,
confirmation dialog, and Load more control.

Daily rows/forms/history groups, Ship status/repair, Expedition quote/current/
history/timeline/result, Profile form, and deletion dialog stay feature-owned.
