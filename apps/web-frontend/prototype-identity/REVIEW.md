# Comparison evidence — not design approval

## Review outcome

The independent finish review found matching type/material/ground and three
materially distinct organizations at this prototype's scope. It requested fixes
for obstructing comparison chrome, the 320px dark Ship layout, and multiline
notice geometry. Its final verdict scored **all three fixes resolved**:

> Ship covers these three fixes at prototype-comparison scope only, not
> whole-surface certification, production approval or human aesthetic selection.

This is a **fix-list verdict**, not a claim that the whole frontend is certified.
Human comparison feedback is still required before resolving the decision ticket.

### Fixes and recapture

- The comparison UI now has its own reserved bottom lane. Opening sample controls
  resizes the independently scrolling app viewport instead of overlaying content.
  Browser assertions verify separation with controls open and closed.
- After hours stacks the Ship diagram and facts below 480px. Hull remains on one
  line and recovery receives full width.
- Update notices use an independent 8px radius and 16px padding, not pill geometry.
- Initial route screenshots inherited blank canvas from the previous route.
  Evidence was rejected, then fully recaptured after target-heading/font/layout
  settlement. Final evidence uses base captures plus `-part-N` scroll captures,
  not blank stitched canvases. The inspector's contact sheets are secondary to
  those direct browser captures.
- Final source cleanup moved menu closure to navigation events and keyboard
  handling to native controls/document listeners, so repo ESLint rules also pass.
  The browser journey was rerun after that cleanup; no visual tokens changed.

## App-screen critique

| App-screen question | Assembly | Daylight | After hours |
| --- | --- | --- | --- |
| What leads? | Actual pending Daily work, then Ship assembly data. | Actual habits and their three completion marks. | Daily rows first, game band next. |
| Does the grid close? | Fluid 1.94:1 work/support tracks; stacks at tablet. | Labelled frame, broad habit area, secondary game column. | Labelled rail, wide task rows, changing game-band spans. |
| Is color meaningful? | Blue marks confirmed intact hull cells/gauge only. | Teal marks hull; completion marks are neutral. | Sky blue marks hull on true black, never neon chrome. |
| Do facts reconcile? | Same shared fixture/state as both others. | Same shared fixture/state as both others. | Same shared fixture/state as both others. |
| Are zeros/absence honest? | Empty sample is 0/0, never fake activity. | No completion marks in empty sample. | No invented reward, result, streak or activity graph. |
| Do visual marks match? | Exactly 100 cells; exactly current hull count intact. | Three marks correspond to these three Dailies. | Same factual hull cells; no fictional Ship telemetry. |
| Does the phone work? | Task-first stack and Menu. | Task-first stack and Menu. | Task-first stack, Menu, full-width narrow-phone Ship facts. |

No aesthetic ranking is implied. Known identity tradeoffs to ask the human about:
Assembly is precise but may feel too clinical; Daylight is least game-forward;
After hours is more atmospheric but uses more vertical space for Ship progression.
Those are comparison prompts, not reasons to declare a winner.

## Numbers checked

Baseline: 42/100 hull, 120 materials, one of three Dailies completed. Completing
the Medium Daily confirms +25; Ship remains 120 until Retry, then 145. Repair
spends 58 and restores 58: 100/100 hull, 87 materials. Investing 40 at full hull
quotes 80% after whole-percent rounding; delayed deduction settles at 47.
All candidates use the same state variables and formula. No handwritten duplicate
balances or arbitrary vanity figures.

## Mechanical evidence

- Prototype strict TypeScript and optimized Vite build: passed.
- Browser verification: 12 full keyboard-activated shared journeys, 36 main-view
  axe scans with WCAG 2/2.1/2.2 AA tags, inner/document reflow checks, reduced-motion
  contexts at 1440/768/390/320, and three state/filter/Menu-Escape/arrow checks.
- Taste source lint: **0 FAIL, 0 WARN**.
- Built-preview inspector, all three sizes per alternative: **0 FAIL**. Assembly
  and Daylight: no warnings. After hours: one accepted 66px `panel-void` warning;
  the action is intentionally pinned to the bottom of a card matched to its neighbor,
  an app-rule allowance accepted by the independent reviewer.
- Impeccable detector: only workhorse-font warnings for the three explicitly dealt
  faces. Retained because this is Operate; the independent review judged the
  differences through organization and signature, not display lettering.
- Production app build, 385 tests across 43 files, production bundle budget/leak
  checks: passed. Production source and production DESIGN.md remain unchanged.
- Repo ESLint and formatting checks: passed after prototype cleanup and generated
  output exclusions. No dependency added. No Go module changed, so Go checks do
  not apply to this work.

The first taste inspector attempt could not locate Chrome; reruns explicitly used
the installed Playwright Chromium. No browser installation or baseline update.
Prototype CSS/source gates ran against the optimized preview, not just development.

## Limitations

Automated axe and a keyboard-driven journey are not a full accessibility audit.
Firefox/WebKit, manual screen reader review, exhaustive focus/200% zoom checks,
real services, CRUD/history/Profile and Expedition resolution are unrun/outside this
prototype. The simulator intentionally compresses update timing and publishes facts
on Retry. Final cross-frontend specification and implementation are later decisions.

The screen's 124px comparison lane is development chrome, not proposed production
navigation. Screenshot parts document the independent app scroll pane; they are
not evidence of a production fixed-height page recommendation.
