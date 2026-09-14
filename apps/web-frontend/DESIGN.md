# Galaxify Web Design System — Phase 1

This is the visual and interaction authority for the Phase 1 frontend. Product
behavior is specified in [`docs/specs/web-frontend.md`](../../docs/specs/web-frontend.md).
The reviewed prototype remains reference material on
[`prototype/galaxify-responsive-experience`](https://github.com/thalesraymond/galaxify-monorepo/tree/prototype/galaxify-responsive-experience/apps/web-frontend/prototype-dashboard)
at commit [`cabf704`](https://github.com/thalesraymond/galaxify-monorepo/commit/cabf704).
Production code must reinterpret it through this system rather than copy the
prototype.

## Direction

Build a **modern captain's log**: focused, tactile, calm, and lightly game-like.
Use Captain's Log's task-first asymmetric structure, Orbital Console's dark
atmosphere, and Star Chart's journey line only as a restrained progression
motif. Do not make a fantasy RPG skin, developer observability console, or
generic component-library dashboard.

Phase 1 uses one mixed theme: a dark desaturated shell around warm logbook
content surfaces with controlled amber and mint accents. There is no theme
toggle.

Avoid glowing neon everywhere, decorative clutter, gratuitous gradients, and
space language that obscures Player, Daily, Ship, or Expedition.

## Foundation tokens

Implementation may tune exact values only when contrast or visual review proves
it necessary. Keep semantic names stable and record intentional changes.

```css
:root {
  --color-shell-deep: #0c2229;
  --color-shell: #142e35;
  --color-shell-raised: #17363e;
  --color-logbook: #f5eddc;
  --color-logbook-edge: #c79243;
  --color-ink: #173038;
  --color-text-on-dark: #f8f0dc;
  --color-text-muted-dark: #b9cbc9;
  --color-text-muted-light: #5f6d69;
  --color-amber: #f5c86a;
  --color-amber-strong: #edb74d;
  --color-mint: #9fd4c9;
  --color-danger: #c84f4f;
  --color-danger-strong: #8f2f2f;
  --color-danger-on-dark: #e08585;
  --color-danger-surface: #742f32;
  --color-text-on-danger: #fff8f0;
  --color-focus: #ffcb69;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;
  --space-16: 4rem;

  --radius-control: 0.5rem;
  --radius-panel: 1.125rem;
  --radius-logbook: 0.25rem 1.375rem 1.375rem 0.25rem;

  --z-base: 0;
  --z-dropdown: 10;
  --z-sticky: 20;
  --z-overlay: 40;
  --z-modal: 100;
  --z-toast: 1000;

  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
}
```

All component colors use semantic custom properties rather than local hex
values. Additional semantic tokens must preserve AA contrast on both dark shell
and warm content surfaces. Never communicate state by color alone.

Recorded contrast tune-ups (issue #146 review): `--color-text-muted-light` moved
to `#5f6d69` (4.65:1 on the logbook surface) and the danger roles were split
into `--color-danger-strong` (danger text on warm surfaces, 6.89:1),
`--color-danger-on-dark` (danger text on the dark shell, 4.81:1 on raised
panels), and `--color-danger-surface` with `--color-text-on-danger` (danger
fills, 9.08:1). `--color-danger` remains the base fill/edge value.

## Typography

- Pair a characterful editorial serif display face with a highly legible UI
  sans-serif. Prefer locally served or explicitly licensed web fonts; robust
  fallbacks are required.
- Suggested fallback stacks: `Georgia, serif` for display and `"Avenir Next",
  "Trebuchet MS", sans-serif` for body/UI.
- Body text is at least 16 px; supporting UI text is never below 14 px.
- Use a consistent scale: 14, 16, 18, 24, 32, 48, 64 px.
- Body line-height is 1.5–1.75; headings use 1.1–1.3; prose is at most 65ch.
- Headings use `text-wrap: balance`; prose uses `text-wrap: pretty`.
- Dynamic numbers and aligned data use tabular numerals.
- Apply antialiasing and optimized legibility at the root.

## Responsive shell

- **Below 768 px:** compact mobile header/account trigger, fixed four-item bottom
  navigation, one task-first column, safe-area-aware bottom padding, no sticky
  action bars.
- **768–1023 px:** narrower persistent labelled sidebar and one-column route
  content.
- **1024 px and wider:** persistent sidebar and optional asymmetric main/support
  columns where content has a genuinely secondary rail.

Desktop primary navigation order and mobile bottom-nav order are Dashboard,
Dailies, Ship, Expeditions. Profile and Logout live in the account menu.

Minimum viewport is 320 CSS px. Every interactive target is at least 44×44 px
with at least 8 px separation where targets are adjacent. Fixed navigation must
not obscure content or focused controls.

## Spatial language

Use the 4/8 px spacing scale. Prefer generous task grouping over dense bento
grids. Warm logbook surfaces contain primary work; dark raised panels contain
supporting Ship/Expedition status. Use layered low-opacity shadows for depth and
subtle edges only where separation requires them.

Nested rounded surfaces use concentric radii: outer radius equals inner radius
plus intervening padding. Align asymmetric icons optically rather than blindly
centering their boxes.

The Dailies → Ship → Expeditions chart trace is a supporting cue. It must not
become a dominant dashboard timeline or reduce Daily scanning efficiency.

## Component states

Every primitive and feature composite must account for default, hover (fine
pointer only), active, focus-visible, disabled, loading, success, validation
error, unavailable, and stale/delayed states where applicable.

- Visible labels are mandatory; placeholders do not replace labels.
- Focus rings are never removed without an equally visible replacement.
- Forms keep errors adjacent to controls and connect them with
  `aria-describedby`.
- Dialogs trap focus, close on Escape, restore focus, and expose labelled dialog
  semantics.
- Skeletons resemble final content; they do not pulse aggressively.
- `Preparing…`, `Updating…`, and `Update delayed` pair text with non-color cues.
- Destructive actions are visually separated and use explicit confirmation.

## Motion

High-frequency navigation, filtering, and Daily completion are immediate and
quiet. Buttons/toggles may use 100–160 ms feedback; popovers/dialogs use
150–300 ms. Exit is faster than enter. Animate only opacity and transforms where
possible; never use `transition: all`.

Use restrained 300–500 ms celebration only for a newly observed Expedition
result or rare milestone. Do not replay it on revisit. All motion respects
`prefers-reduced-motion`; status and meaning survive when motion is removed.

## Accessibility contract

- Meet WCAG 2.2 AA: 4.5:1 normal text and 3:1 large text/UI graphics.
- Use semantic HTML before ARIA and one logical `h1` per route.
- Provide a skip link and logical heading/focus order.
- Support keyboard operation, Escape dismissal, focus containment/restoration,
  and expected arrow-key behavior inside composite widgets.
- Announce command outcomes, rollbacks, and delayed propagation once in scoped
  live regions. Do not announce polling attempts or countdown ticks.
- Support 200% zoom, 320 px reflow, reduced motion, touch, and keyboard without
  content loss or accidental two-dimensional scrolling.

## Review rule

Visual baselines at 390×844 and 1440×900 cover the shell and representative
populated, loading, empty/unavailable, error/retry, form, and dialog states.
Baseline changes require a reviewed diff; tests never auto-accept them.
