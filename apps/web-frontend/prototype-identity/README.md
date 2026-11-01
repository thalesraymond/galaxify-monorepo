# Galaxify identity comparison

**Throwaway interactive prototypes. Not production, not an approved direction.**

## Run

From `apps/web-frontend`, with the existing locked dependencies installed (`npm ci`):

```sh
npm run prototype:identity
```

No backend, account, environment file or credentials needed. The production app
is not imported or rewritten. This standalone Vite entry uses the existing stack.

Open each alternative separately, or use the comparison control in its reserved
bottom lane. The app scrolls independently above that lane; expanding sample
controls resizes the app viewport rather than covering its work:

- [Assembly](http://127.0.0.1:4318/dashboard?variant=assembly) — top navigation,
  compact task work, a cell-based Ship assembly diagram, tight shapes.
- [Daylight](http://127.0.0.1:4318/dashboard?variant=daylight) — personal greeting,
  labelled sidebar, soft tonal sections, habit-completion marks, less game imagery.
- [After hours](http://127.0.0.1:4318/dashboard?variant=after-hours) — neutral dark,
  compact Daily table, game facts in a horizontal band, visible damaged Ship cells.

`/dailies`, `/ship`, and `/expeditions` work inside this isolated app. Share the
`?variant=` value; reload resets all data. Switching alternatives preserves state
so the same moment can be compared. **Reset sample** returns to the common baseline.
Arrow keys on the comparison control cycle alternatives; native selects/inputs
keep their normal arrow-key behavior. Mobile navigation is under Menu.

## Compare fairly

For **each** alternative, on desktop and phone:

1. Under **Sample controls & state**, choose **Reset sample**.
2. Complete **Walk outside for 20 minutes**. The row immediately completes.
3. Open **Inspect Ship**. The award is confirmed, but materials stay at **120**.
   Observe **Updating…**, then **Update delayed**. Repair/Launch stay gated.
4. Choose **Retry update**: confirmed materials become **145**.
5. Choose **Repair Ship**: after confirmation hull becomes **100/100**, materials
   **87**. Wait for readiness's delayed state, then **Retry update**.
6. Open **Plan an Expedition**, keep **40** materials, and launch. Expedition is
   confirmed in flight first; Retry its delayed deduction to see balance **47**.
7. Try Empty, Loading and Unavailable Daily states; Retry Dailies recovers locally.

The demo deliberately compresses downstream delay to 1.4 seconds and uses an
explicit Retry to publish synthetic facts. This is **not** the production polling
implementation. Repair uses a deterministic example of variable restoration;
the quote uses the existing investment/(investment+10) × hull/100 formula.
No backend writes, persistence, invented streaks, currencies or gameplay systems.

### React to all three, not just your first impression

- Which makes completing a Daily easiest? Which makes the Ship reward worth noticing?
- For each: what would you keep, what feels wrong, and what feels too generic?
- Does the mobile version change your opinion? Is the difference in game immersion useful?
- Want another set instead? All three may be rejected; nothing forces a winner.

This ticket records comparison feedback. Selecting a direction or defining a
blend belongs to **Choose Galaxify’s direction or define an intentional blend**.
Neither feedback nor prototype selection authorizes merging this code.

## Evidence and checks

```sh
npm run prototype:identity:build
npm run prototype:identity:preview
# In another terminal, from apps/web-frontend:
node prototype-identity/verify-browser.mjs
```

Built preview is at port **4319**, with the same routes/query parameters. Development
uses port **4318**. Incumbent mock-baseline capture uses its own port **4317**.

- `evidence/before/`: real incumbent, clock aligned to its January 15 mock fixtures.
- `evidence/before-current-date/`: real incumbent on the session date (empty Dailies
  because fixtures have a fixed older date), not a redesign regression.
- `evidence/after/`: all three alternatives, main views and journey states at
  1440, 768, 390 and 320px; Daily empty/loading/unavailable at 390px.
  Additional `-part-N` captures walk the app's independent scroll pane from top
  to bottom, so the comparison lane never hides content in the evidence.
- `evidence/after/verification.json`: 12 shared journeys, 36 main-view axe scans,
  overflow checks, reduced-motion contexts and keyboard button activation; three
  scenario/filter/menu-Escape/comparison-key checks. This is exploration evidence,
  not a production regression suite.
- `evidence/taste/`: recorded direction draws and inspector rounds. The final
  measurements are `reviewed-assembly`, `reviewed-daylight` and
  `reviewed-after-hours`; earlier folders preserve the before/fix history.
  Absolute local screenshot paths have been converted to portable references.
- `DIRECTIONS.md`: question, derivation, contracts, seeds, challenger verdicts.
- Prototype `DESIGN.md`: the explored tokens and their scope, not an authority
  for production. `../DESIGN.md` remains unchanged.

Unrun: Firefox/WebKit, manual screen reader testing, production APIs, exhaustive
200% zoom/focus-obscuration audit, and the whole frontend's route/state matrix.
Authentication, CRUD, history, result resolution and Profile are not implemented
here; this ticket compares the agreed journey, not a replacement application.

## Asset provenance

- Ship and Galaxify mark: original code-authored SVG geometry. Hull has exactly
  100 cells and colors exactly the confirmed intact count; no decorative fake data.
- Fonts: self-hosted, unmodified Google Fonts distributions, retrieved 2026-11-01:
  [Geist](https://github.com/google/fonts/tree/main/ofl/geist),
  [Instrument Sans](https://github.com/google/fonts/tree/main/ofl/instrumentsans),
  [Inter](https://github.com/google/fonts/tree/main/ofl/inter). Each font's OFL
  license and copyright notices are in `fonts/`. No external font request at runtime.
- No generated images, stock photography or third-party artwork ships. Impeccable
  streaming-world references are critique references only, not app assets.
- Rowan, Daily texts, dates, balances and deterministic outcomes are synthetic.

Tracker: [Compare three distinct Galaxify frontend prototypes](https://github.com/thalesraymond/galaxify-monorepo/issues/272).
