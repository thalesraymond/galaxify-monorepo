---
name: Galaxify convergence prototype (provisional)
description: Delta record for the disposable convergence round; inherits the selected After hours system, no production authority.
colors:
  inherited-from: "../prototype-identity/DESIGN.md (After hours block)"
typography:
  inherited-from: "../prototype-identity/DESIGN.md"
---

# Design System: Galaxify convergence prototype

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
- **Dedicated form routes** (`/dailies/new`, `/dailies/edit/:id`) at all widths,
  bounded to 760px: title (max 120), optional description (max 1000), difficulty
  with reward/damage stakes stated beside the control. Dirty guards on links,
  Cancel and unload; save returns to the list, focuses and outlines the changed
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

## Do's and Don'ts

- **Do** treat Dashboard as summary and Dailies as management; the duplicated
  comparison view was a prototype limitation, not architecture.
- **Do** keep URL-scoped date/status, immediate completion, and confirmed-fact
  gating with explicit delayed-update feedback.

- **Don't** treat this delta as approval to merge, or extend its authority past
  the prototype branches. Production `../DESIGN.md` is untouched.
- **Don't** read the static History fixtures or simulated failure states as
  backend behavior.
