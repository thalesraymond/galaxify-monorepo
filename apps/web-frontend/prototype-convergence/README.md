# After hours — convergence prototype

**Fourth, disposable prototype. No production UI changes or permission to merge.**

The selected comparison remains intact in `../prototype-identity`. This extends
its After hours grammar and the human-selected top navigation / spacecraft mosaic.
Inherited seeds: Impeccable `seed:733f88c8e849d5f5`, taste true-black-flat
`1709645772`. No new direction draw or palette swap.

## Run

From `apps/web-frontend`:

```sh
npm ci
npm run prototype:convergence
```

Open http://127.0.0.1:4320/dashboard. No account, backend, secrets or environment
file needed. Reload resets the in-memory sample. Build preview uses port 4321:

```sh
npm run prototype:convergence:build
npm run prototype:convergence:preview
```

## Try this split

1. **Dashboard:** complete Walk outside for 20 minutes. Pending work leads;
   completed habits collapse. Ship and Expedition are summaries, not management forms.
2. **Dailies:** use previous/next, Today, the date picker and status filter. Scope
   lives in the URL; Today is pinned to the synthetic January 15, 2026 snapshot.
3. Create a Daily, edit it on its dedicated page, save, complete, or delete it.
   Save highlights/focuses the changed row. Dirty links/Cancel/unload warn; delete
   names the habit and explains that History is preserved.
4. Open **History** for preserved Completed and Missed outcomes with typed effects
   and description disclosures. The two historical outcomes are fixed fixtures.
5. From Dashboard, **Inspect Ship**. Observe Updating → Update delayed; the awarded
   25 materials are not yet spendable. Retry changes balance 120 → 145.
6. Repair: confirmed hull becomes 100 and materials 87. Retry delayed readiness;
   plan an Expedition, invest 40, launch, then Retry the deduction: balance 47.
7. Sample controls expose empty/loading/unavailable states and a reset. Try phone
   Menu, keyboard, and 320px reflow. Forms retain readable difficulty stakes even
   if the native select truncates its option label.

## Questions for live acceptance

- Are Dashboard's summary and Dailies' management role now distinct and useful?
- Does the chosen identity hold across forms, History, damage and delayed updates?
- Is mobile navigation / task density comfortable? What specifically needs changing?

Browser evidence is not acceptance. The convergence decision remains open until
the human explicitly accepts this round or requests changes.

## Evidence and boundaries

Run `node prototype-convergence/verify-browser.mjs` against the built preview.
It drives four widths (1440/768/390/320), core journey and management interactions,
checks axe, overflow, keyboard completion/repair/launch, and captures every scroll
segment above the separate prototype-control lane. `evidence/verification.json`
records the actual results. Taste inspector reports and captures are under
`evidence/taste-*`; see `REVIEW.md` for critique and unrun checks.

This is not a frontend replacement: authentication/Profile, server validation,
recurrence/timezone calculations, History pagination and Expedition results remain
outside this round. History is static; a new completion does not synthesize a
server-generated past occurrence. Browser Back does not implement the production
router's dirty-form blocker. Network/provisioning failures are simulated, not API
proof. Same deterministic 58-material/58-hull repair and quote formula as comparison.

Production `../DESIGN.md` and code under `../src` are untouched. The selected
prototype's `../prototype-identity/DESIGN.md` supplies inherited tokens; `BRIEF.md`
records this round's layout contract, not a new production system.

Assets: original code-authored Galaxify mark and 100-cell hull geometry; self-hosted
Inter (app) and Geist (prototype controls), Google Fonts distributions with OFL
licenses under `fonts/`. Instrument Sans is an unused inherited comparison font.
No generated images, stock imagery or new third-party artwork. All Player names,
habits, dates, balances, history and outcomes are explicitly synthetic.

Tracker: [Test the chosen direction in a convergence prototype](https://github.com/thalesraymond/galaxify-monorepo/issues/274).
