---
name: Galaxify identity comparison (provisional)
description: After hours selected for prototype refinement; no approved production identity.
colors:
  assembly-ground: "#f8f8f8"
  assembly-surface: "#fff"
  assembly-raised: "#eee"
  assembly-border: "#e6e6e6"
  assembly-ink: "#0a0a0a"
  assembly-muted: "#626262"
  assembly-data: "#1d5fbf"
  shared-control: "#777"
  light-danger: "#a12d30"
  light-primary: "#141414"
  daylight-ground: "#f5f6f5"
  daylight-surface: "#f7f8f7"
  daylight-raised: "#e9ece9"
  daylight-border: "#e6e9e6"
  daylight-ink: "#1f201d"
  daylight-muted: "#5d635e"
  daylight-data: "#1b6e66"
  afterhours-ground: "#000"
  afterhours-surface: "#111"
  afterhours-raised: "#252525"
  afterhours-border: "#292929"
  afterhours-ink: "#fff"
  afterhours-muted: "#b4b4b4"
  afterhours-data: "#65bde9"
  afterhours-danger: "#ff9ca5"
typography:
  assembly-body:
    fontFamily: "Geist, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  daylight-body:
    fontFamily: "Instrument Sans, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  afterhours-body:
    fontFamily: "Inter, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  headline:
    fontSize: "28px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontSize: "18px"
    fontWeight: 500
    lineHeight: 1.3
  row-title:
    fontSize: "16px"
    fontWeight: 500
  label:
    fontSize: "14px"
  hull-figure:
    fontSize: "30px"
    fontWeight: 400
rounded:
  assembly-section: "8px"
  assembly-control: "6px"
  daylight-section: "22px"
  afterhours-section: "20px"
  soft-control: "999px"
  sheet: "16px"
  notice: "8px"
spacing:
  compact: "8px"
  small: "12px"
  medium: "16px"
  section-mobile: "20px"
  section: "24px"
  large: "32px"
  heading: "40px"
components:
  assembly-primary:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.assembly-surface}"
    rounded: "{rounded.assembly-control}"
    padding: "8px 14px"
  daylight-primary:
    backgroundColor: "{colors.light-primary}"
    textColor: "{colors.assembly-surface}"
    rounded: "{rounded.soft-control}"
    padding: "8px 14px"
  afterhours-primary:
    backgroundColor: "{colors.afterhours-ink}"
    textColor: "{colors.afterhours-ground}"
    rounded: "{rounded.soft-control}"
    padding: "8px 14px"
  update-notice:
    rounded: "{rounded.notice}"
    padding: "{spacing.medium}"
---

# Design System: Galaxify identity comparison

## Overview

**Creative North Star: "Three exploratory worlds, one habit-to-Ship loop"**

This is a code-led, Operate-mode prototype, not a production brand system. After comparing Assembly's model-kit ledger, Daylight's personal habit planner, and After hours' flat black catalogue, the user selected **After hours**, amended with **Assembly's top navigation** and a **spacecraft-shaped Ship mosaic**. Production approval and cross-frontend validation remain outstanding. The original comparison is preserved at commit `2073fa1`.

The authority here stops at this disposable prototype. [PRODUCT.md](../PRODUCT.md) supplies product truth; [DIRECTIONS.md](DIRECTIONS.md) supplies alternative contracts. The observed implementation is [prototype.module.css](prototype.module.css), [main.tsx](main.tsx), and [data.ts](data.ts). This record does not alter the production `../DESIGN.md` or certify the whole frontend.

**Key Characteristics:**
- After hours selected for refinement; two original alternatives remain available.
- Immediate Daily completion; confirmed Ship facts and explicit delayed updates.
- Code-authored geometry and licensed self-hosted type, not generated imagery.

## Colors

### Primary

Assembly uses ink actions with blue condition data; Daylight inherits the dark primary action while using teal condition data; After hours reverses primary actions to white and uses sky-blue condition data. The frontmatter records each actual palette, not a merged brand palette. Daylight's Daily completion control is outlined, unlike its filled repair/launch action.

### Neutral

Each alternative has its own ground, section surface, raised state, divider, ink, and muted text. Daylight also uses a white outer sheet. Control borders inherit the shared control token across all alternatives. Danger tokens are declared in CSS but currently have no rendered error-color assignment; do not infer one.

**The Alternative Boundary Rule.** Keep each provisional palette with its own shell; do not promote or blend it into production identity.

## Typography

Assembly uses Geist, Daylight Instrument Sans, and After hours Inter, each falling back to sans-serif. These are self-hosted variable fonts; sources and OFL licenses are under [fonts/](fonts/). No separate display or mono face is implemented. Numeric facts use tabular figures.

The hierarchy uses the frontmatter headline, section title, row title, body, label, and hull-figure roles. Headline exceptions: Daylight uses regular weight (400); After hours uses a smaller heading (24px). At widths up to 640px the other headings also become 24px. Materials and flight-time figures use 24px, regular weight. Paragraphs are bounded to 68ch. Daylight's three completion marks use 12px labels and represent the three actual fixture Dailies, not a streak.

## Layout

Assembly: centered frame (1248px maximum, 24px side padding), top navigation (88px minimum), work/support tracks (1.94fr/1fr) and 24px gaps. Daylight: sidebar (216px), white sheet (32px inset), work area (1100px maximum), work/support tracks (9fr/3fr, support minimum 250px), 16px gaps. After hours now uses Assembly's centered frame and top-navigation geometry in its own dark palette, with Daily rows above a Ship/Expedition band (1.4fr/1fr, 24px gap).

At 1100px, Daylight's rail narrows to 180px; Daylight work, detail views, and the game band become one column, with Daylight support temporarily two columns. At 850px desktop navigation is replaced by a labelled Menu and 72px top reservation; side padding becomes 20px. At 640px support and rows stack. At 480px After hours Ship geometry sits above its facts and shrinks to 100px high; hull numbers do not wrap.

**The Reserved Comparison Lane Rule.** Comparison controls occupy a separate bottom lane (124px closed; `min(52dvh, 420px)` open). The app's height is the remaining dynamic viewport and it scrolls independently above that lane. Do not interpret a base viewport capture as the full independently scrolling journey.

## Elevation & Depth

All three alternatives use flat tonal layering, dividers, and whitespace. No shadows, gradients, or glow are implemented. Focus is an outline (3px, 4px offset): blue in Assembly and Daylight, sky blue in After hours. Daylight inherits Assembly's focus color, not its own teal data color.

## Shapes

Assembly combines compact controls with lightly rounded sections. Daylight and After hours use pill controls with softer sections; Daylight's outer sheet has its own radius. Notices retain the shared notice shape and padding in every alternative, independent of section radius. The hull is 100 authored SVG cells (12px squares, 1px corner radius). After hours' detailed Ship silhouette now has a nose, swept wings and split engines: intact cells use data color, damaged cells have a neutral control-color outline. Compact overview mosaics keep the original geometry. Daylight deliberately omits this diagram and retains the numeric/meter facts.

## Components

- **Buttons and fields:** outlined controls, 44px minimum height, 8px/14px padding. Primary repair/launch buttons are filled. Complete is filled only in Assembly. Disabled controls use raised backgrounds, muted text, and divider borders. Hover-capable devices underline enabled buttons and navigation; pressing an enabled button translates it down 1px over 120ms ease-out. Reduced motion removes the transition.
- **Navigation:** visible labels; active links use ink on raised tone except After hours, whose active background remains transparent. Mobile Menu exposes the same links; Escape closes it and returns focus. Route changes focus the page heading.
- **Sections and rows:** sections use 24px padding, reduced to 20px on mobile; Daylight support uses 20px throughout. After hours Daily work is transparent with no section padding and hides descriptions, not due/difficulty/reward facts. Completed row titles are struck through with a disabled Completed button.
- **Investment field and quote:** labelled number input, confirmed balance, after-investment value, chance, and resolve window. Invalid values show textual guidance and disable launch; no invented error-color state.
- **Update notice:** bordered, 16px padding, 8px radius; Updating changes to Update delayed with a local Retry update button. Last confirmed facts remain visible and repair/launch remain gated until refresh.
- **Sample states:** populated, loading, empty, unavailable with local retry; repair/launch busy and disabled states; full hull; invalid investment; in-flight Expedition. These are deterministic frontend simulations, not service validation.

## Do's and Don'ts

### Do:
- **Do** retain the alternative-specific palette, typeface, geometry, and shell together while comparing.
- **Do** preserve independent app/lab scrolling, narrow-phone Ship stacking, and the shared notice geometry.
- **Do** label synthetic data and keep confirmed facts distinct from pending rewards or deductions.

### Don't:
- **Don't** treat any alternative, descriptive language, or token here as user-approved production identity.
- **Don't** infer whole-frontend, backend, or WCAG certification from this three-view journey review.
- **Don't** turn screenshot evidence or synthesized sidecar preview ramps into shipping image assets or new palette tokens.

Evidence: [evidence/after/](evidence/after/) contains base and `-part-N` independent-scroll captures. Temporary repository-root `.taste-skill/reviewed-*` reports supplement those captures. The supplied finish review resolved all three material findings and permits shipping the fixes/prototype comparison only; it is not whole-surface production certification. No shipping rasters exist beyond evidence captures, and no generated assets were used. Not canonized: no broader brand approval, invented component state, or unreviewed production rule; no source defects were repaired by this documentation pass.
