---
name: Galaxify After hours
description: Production design system for Galaxify — quiet nocturnal interface with self-hosted Inter, black ground, charcoal sections, white primary controls, sky-blue condition data, and coral-rose danger states.
colors:
  ground: "#000000"
  surface: "#111111"
  raised: "#252525"
  border: "#292929"
  control: "#777777"
  ink: "#ffffff"
  muted: "#b4b4b4"
  data: "#65bde9"
  danger: "#ff9ca5"
  primary: "#ffffff"
  on-primary: "#000000"
  focus: "#65bde9"
typography:
  fontFamily: "'Inter', sans-serif"
  body:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  supporting:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  heading:
    fontSize: "24px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  sectionTitle:
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.3
  rowTitle:
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.5
  brand:
    fontSize: "20px"
    fontWeight: 500
  hullFigure:
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1.1
  metricFigure:
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.2
rounded:
  section: "20px"
  control: "999px"
  notice: "8px"
  input: "8px"
  meter: "99px"
spacing:
  section: "24px"
  sectionMobile: "20px"
  interPanel: "24px"
  targetGap: "8px"
layout:
  frameMaxWidth: "1248px"
  formMaxWidth: "760px"
  dialogMaxWidth: "480px"
  desktopNavMinHeight: "88px"
  mobileHeaderMinHeight: "72px"
  mobileBreakpoint: "850px"
---

# Galaxify Web Design System — After hours

This is the visual and interaction authority for the Galaxify frontend. Product
behavior is specified in [`docs/specs/web-frontend.md`](../../docs/specs/web-frontend.md),
delivery and verification in
[`docs/specs/web-frontend-delivery.md`](../../docs/specs/web-frontend-delivery.md),
and redesign route/migration acceptance in
[`docs/specs/frontend-redesign.md`](../../docs/specs/frontend-redesign.md).

## Direction

Build an **After hours** quiet nocturnal instrument: black ground, charcoal
sections, crisp white primary ink, and sky-blue condition telemetry for evening
habit reflection and spacecraft upkeep.

- Operate-mode workspace: task-first legibility, immediate Daily completion,
  confirmed Ship facts, and explicit delayed-update recovery.
- Single fixed dark palette: no light/dark toggle, no alternate skins, no
  decorative glow, gradients, drop shadows, or nested card chrome.
- Canonical nouns (`Player`, `Daily`, `Ship`, `Expedition`) remain explicit;
  status never relies on color alone.

## Color and semantic tokens

Tokens are declared in [`src/shared/styles/tokens.css`](./src/shared/styles/tokens.css)
using CSS Custom Properties inside CSS Modules. Components consume semantic
tokens rather than local hex literals.

| Semantic token | Value | Role | Verified contrast |
| --- | --- | --- | --- |
| `--color-ground` | `#000000` | Page canvas | — |
| `--color-surface` | `#111111` | Sections, dialogs, menus, inputs | — |
| `--color-raised` | `#252525` | Raised containers, disabled fills, hover fills | — |
| `--color-border` | `#292929` | Decorative hairlines and dividers (never sole boundary of an active control) | — |
| `--color-control` | `#777777` | Enabled control, input, and select boundaries | `4.23:1` vs `#111111` (SC 1.4.11 ≥ 3:1) |
| `--color-ink` | `#ffffff` | Primary copy and headings | `21.0:1` vs `#000000`, `19.27:1` vs `#111111` |
| `--color-muted` | `#b4b4b4` | Secondary descriptions, labels, metadata | `10.19:1` vs `#000000`, `9.21:1` vs `#111111`, `6.87:1` vs `#252525` |
| `--color-data` | `#65bde9` | Telemetry values, gauges, intact hull cells | `9.51:1` vs `#111111`, `7.39:1` vs `#252525` |
| `--color-danger` | `#ff9ca5` | Validation errors, danger outlines, unavailable/delayed accents | `9.01:1` vs `#111111`, `7.00:1` vs `#252525` |
| `--color-primary` / `--color-on-primary` | `#ffffff` / `#000000` | Primary pill actions (`Save`, `Repair`, `Launch`) | `21.0:1` |
| `--color-focus` | `#65bde9` | Keyboard focus outline (`3px solid`, `4px` offset) | `10.35:1` vs `#000000`, `9.51:1` vs `#111111` |

Danger relies on `--color-danger` text/borders paired with explicit labels and
confirmation dialogs. Never invent a pink-filled button with white text.

During the incremental rollout under epic `#285`, legacy token names
(`--color-shell*`, `--color-logbook*`, `--color-amber*`, `--color-mint`,
`--color-text-*`, `--color-danger-*`) remain defined in `tokens.css` as aliases
to the After hours palette so unmigrated feature CSS modules keep AA contrast
until feature tickets `#287`–`#291` complete, after which `#292` removes unused
aliases.

## Typography and self-hosted font provenance

All player-facing copy and numerals use self-hosted variable **Inter** with
`sans-serif` fallback and `font-display: swap`.

- **Source & license**: [`src/shared/styles/fonts/inter.woff2`](./src/shared/styles/fonts/inter.woff2)
  and [`src/shared/styles/fonts/inter-OFL.txt`](./src/shared/styles/fonts/inter-OFL.txt)
  (SIL Open Font License 1.1).
- **Conversion & coverage**: Generated from the pinned prototype variable
  TrueType font (`dca3e21:apps/web-frontend/prototype-identity/fonts/inter.ttf`,
  847,019 bytes) via `woff2_compress` (350,223 bytes) with 100% glyph coverage
  retained (Latin, extended Latin, punctuation, arrows, and tabular figures). No
  remote font requests and no extra font families (`Geist`, `Instrument Sans`)
  are shipped.
- **Scale & numerals**:
  - Brand mark text: `20px`, weight `500`
  - Route `h1`: `24px` (`1.5rem`), weight `500`, line-height `1.2`, tracking `-0.025em`
  - Section `h2`: `18px` (`1.125rem`), weight `500`, line-height `1.3`
  - Row `h3` / body: `16px` (`1rem`), weight `500` (headings) / `400` (body), line-height `1.5`, body measure capped around `65ch`
  - Supporting copy / labels / errors: `14px` (`0.875rem`), line-height `1.5`
  - Numeric hull figure: `30px` (`1.875rem`), weight `400`; material & countdown figures: `24px` (`1.5rem`), weight `400`
  - `font-variant-numeric: tabular-nums` is enabled globally so dates, counts, percentages, and hull figures align cleanly.

## Layout and responsive navigation

- **Outer frame**: Centered `1248px` max-width (`--frame-max-width`), `24px`
  horizontal gutters (`20px` at `<= 850px`), ordinary document scrolling.
- **Desktop (`> 850px`)**: Single top navigation bar (`88px` min-height, `1px`
  `--color-border` bottom divider) with code-authored Galaxify mark on the left,
  centered `<nav aria-label="Primary">` (`Dashboard`, `Dailies`, `Ship`,
  `Expeditions`) using white text (`500`) on transparent background for the
  active route and `--color-muted` for inactive routes with `aria-current`, and
  the `Account` menu (`Profile`, `Log out`) on the right.
- **Mobile & narrow viewports (`<= 850px`)**: Compact top bar (`72px` baseline
  min-height, allowed to grow for text zoom) with `Galaxify`, a labelled
  `Menu` disclosure trigger (`aria-expanded`, `aria-controls`), and `Account`.
  No sidebar and no fixed bottom navigation bar. Opening `Menu` reveals the
  primary links constrained cleanly within viewport height; pressing `Escape`
  closes `Menu` and restores focus to the trigger; route navigation closes
  `Menu` and moves focus to `#main-content h1` (unless an explicit destination
  row target such as `dailyFocus` takes priority).
- **Focused form surfaces & dialogs**: Auth (`/signup`, `/login`) and Daily
  forms cap content width at `760px`; confirmation dialogs cap at `480px` width
  and `85dvh` height with internal scroll and full `320px` reflow.
- **Touch targets**: Interactive controls enforce at least `44×44px` hit areas
  and at least `8px` spacing between adjacent targets.

## Component states and authored SVG signatures

All shared primitives (`Button`, `ContentSurface`, `Dialog`, `ConfirmationDialog`,
`Disclosure`, `EmptyState`, `Field`, `FormError`, `Gauge`, `LiveRegion`,
`LoadMore`, `LocalTabs`, `Menu`, `PageHeader`, `RouteFallback`, `Skeleton`,
`SkipLink`, `StatusBadge`, `UnavailableState`) share one vocabulary:

- **Buttons & links**: Pill radius (`999px`), `8px 14px` (`10px 18px` for generous
  balance at `44px` height), `1px` control border on outlined actions, solid
  white (`#ffffff` / `#000000`) on primary actions, danger foreground & border
  on destructive actions, and `#252525` fill / `#b4b4b4` ink / `#292929` border
  on disabled controls with adjacent textual explanations.
- **Inputs, selects, textareas**: `1px solid #777777` border on `#111111` (or
  `#000000` inside `#111111` panels so edges stay distinct), `8px` radius on
  textareas and multiline fields, pill radius where appropriate for compact inputs
  and selects, visible `<label>` and explicit error text linked by `aria-describedby`.
- **Notices, skeletons & states**: Notices use `8px` radius (`--radius-notice`)
  and `16px` padding (`--space-4`); loading states render section-shaped
  `#252525` skeletons matching content geometry instead of generic spinners;
  `UnavailableState` and `EmptyState` preserve clean recovery actions (`Retry`,
  destination links).
- **Authored SVG brand mark**: `32×32` geometric craft/horizon stroke mark in
  `currentColor`, `aria-hidden="true"`.
- **Authored 100-cell spacecraft hull silhouette** (delivered on `/ship` and
  summarized on `/dashboard`): `10×10` grid SVG (`role="img"`) encoding `0–100`
  confirmed hull; intact cells filled `#65bde9` (`#ff9ca5` when critical),
  damaged cells outlined `#777777`, always accompanied by numeric hull (`X / 100`)
  and `<Gauge>`. Cells are never keyboard targets.

## Motion and accessibility guardrails

- Standard UI transitions run at `140ms ease` (enabled button press `translateY(1px)`
  over `120ms` when motion is allowed); `@media (prefers-reduced-motion: reduce)`
  eliminates non-essential movement while preserving all state and meaning.
- Browser surfaces (`color-scheme: dark`, `::selection`, `scrollbar-color`,
  `:focus-visible` `3px solid #65bde9` with `4px` offset) are themed from the
  After hours tokens.
- Automated `axe-core` WCAG 2.2 AA scans, keyboard traversal, live-region
  announcements (excluding polling/countdown ticks), 200% zoom, `320px` reflow,
  and cross-browser verification remain mandatory release gates.
