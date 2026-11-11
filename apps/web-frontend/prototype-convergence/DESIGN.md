---
name: Galaxify convergence prototype (provisional)
description: Delta record for the disposable convergence round; inherits the selected After hours system, no production authority.
colors:
  ground: "#000"
  surface: "#111"
  raised: "#252525"
  border: "#292929"
  control: "#777"
  ink: "#fff"
  muted: "#b4b4b4"
  data: "#65bde9"
typography:
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  heading:
    fontSize: "24px"
    fontWeight: 500
  section-title:
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.3
  label:
    fontSize: "14px"
  brand:
    fontSize: "20px"
    fontWeight: 500
  hull-figure:
    fontSize: "30px"
    fontWeight: 400
  sample-controls:
    fontFamily: "Geist, sans-serif"
    fontSize: "14px"
rounded:
  section: "20px"
  control: "999px"
  notice: "8px"
  meter: "99px"
  sample-controls: "6px"
spacing:
  section: "24px"
  section-mobile: "20px"
components:
  primary-button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "44px"
---

# Design System: Galaxify convergence prototype

## Overview

**Creative North Star: "After hours"**

This task-first workspace is clear and restrained: a black ground, charcoal
surfaces, white ink, and sky-blue data support readable controls and state.
Depth comes from flat tonal layering and dividers rather than shadows.

**Key Characteristics:**
- Visible labels and generous control targets.
- Confirmed facts remain distinct from delayed updates.
- Synthetic data and disposable prototype scope remain explicit.

## Scope

This is the fourth, disposable prototype: a synthesis of the human-selected
After hours direction (Assembly top navigation, spacecraft hull mosaic) carried
across a **split information architecture** confirmed by the human this session:

- **Dashboard** — cross-loop summary: pending Dailies first (completed collapsed
  behind a disclosure), Ship condition and Expedition as summaries with links,
  never the full investment form.
- **Dailies** — management workspace: Current/History local navigation,
  URL-scoped date (`?date=`) and status (`?status=`) controls, Previous/Next/
  Today and a date picker, full task rows with Edit/Delete, and Create Daily
  beside the heading in every list state.
- **Dedicated form routes** (`/dailies/new`, `/dailies/:id/edit`) at all widths,
  bounded to 760px: title (max 120), optional description (max 1000), difficulty
  with reward/damage stakes stated beside the control. Dirty guards on links,
  Cancel, browser Back and unload; save returns to the list, focuses and outlines the changed
  row; announcements via the live region.
- **History** — preserved Completed/Missed occurrences with typed effects
  (+materials / −hull), UTC times and description disclosures; static synthetic
  fixtures, no Load more in this round.

## Authority

Every token, face, focus style, control geometry and component rule is
inherited unchanged from the selected comparison prototype's
[DESIGN.md](../prototype-identity/DESIGN.md) (After hours block) and its
implementation. This round adds surfaces, not style: no palette, typeface,
radius or component vocabulary was redrawn. The direction contract for this
round is [BRIEF.md](BRIEF.md); the review record is [REVIEW.md](REVIEW.md).

## Components

- **Buttons and fields:** Controls have a 44px minimum height, pill-shaped
  outlines, and 8px by 14px padding. Primary actions use white on black's
  inverse; Daily completion is outlined. Disabled controls use the raised
  surface, muted text, and divider border. Hover underlines; pressing an enabled
  button moves it down 1px. Reduced motion removes the transition.
- **Focus and navigation:** Interactive elements have a 3px sky-blue focus
  outline with a 4px offset. Active navigation uses white text without a filled
  background. At 850px and below, Menu replaces desktop navigation; Escape
  closes it and returns focus. Route changes focus the page heading.
- **Sections and Daily rows:** Charcoal sections have 20px corners and 24px
  padding (20px on mobile). The Daily workspace is transparent; rows use
  dividers and retain descriptions, status, difficulty, and stakes. Completed
  titles are struck through and their completion buttons are disabled.
- **Forms and notices:** The Daily form is bounded to 760px with visible labels;
  its textarea has an 8px radius. Update notices have an 8px radius, a control
  border and 16px padding; delayed updates offer a local Retry action.
- **Ship mosaic:** The detailed spacecraft contains 100 SVG cells; intact cells
  use the data color and damaged cells use outlines. The numeric hull value and
  meter accompany the diagram rather than relying on color alone.
- **Account forms and destructive dialog:** Account samples use the same labelled
  fields and outlined/filled actions, not a new visual vocabulary. Hints stay
  separate from field names. The deletion dialog uses the section surface and
  corner shape, a dark backdrop, constrained viewport height and internal scroll.
  Password receives focus; Tab wraps, Escape/Cancel close it, and focus returns
  to its trigger. Account submission and deletion affect only synthetic memory.

## Do's and Don'ts

- **Do** treat Dashboard as summary and Dailies as management; the duplicated
  comparison view was a prototype limitation, not architecture.
- **Do** keep URL-scoped date/status, immediate completion, and confirmed-fact
  gating with explicit delayed-update feedback.

- **Don't** treat this delta as approval to merge, or extend its authority past
  the prototype branches. Production `../DESIGN.md` is untouched.
- **Don't** read the static History fixtures or simulated failure states as
  backend behavior.
