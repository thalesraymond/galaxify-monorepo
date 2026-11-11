# Cross-frontend review — #275

## Authority

The accepted After hours palette, self-hosted Inter, Assembly-derived top
navigation and 100-cell spacecraft are preserved. This is an extension of the
existing convergence, not a new identity selection. PRODUCT.md and BRIEF.md
remain binding; production UI is untouched. Coverage and runnable examples are
in [COVERAGE.md](COVERAGE.md).

## Checks

- Current verification uses Node **v24.22.2**, Chromium **156.0.8078.4**
  (earlier sessions used Node 26).
- Prototype TypeScript/Vite build and the cross-frontend browser suite passed
  against built output, not merely source markup.
- Automated checks include route inventory, four widths, 320px internal/document
  reflow, reduced-motion context, axe, account/error/retry interactions, dialog
  keyboard/focus and dirty browser navigation. Results are recorded with browser
  and Node versions in the new evidence directory.
- Inherited core-flow checks passed all **8 groups**, separately; historical goldens are not silently
  updated or reclassified as cross-frontend approval.
- No Go code is changed, so Go build/test/vet do not apply to this prototype-only
  diff. Dependency upgrades and audit fixes are outside the identity task.

## Detector findings

The mechanical detector flagged inherited Inter/Geist/Instrument Sans and
incomplete type/radius coverage in the provisional delta document. The fonts
are inherited from the selected identity (Geist belongs to the sample lane;
Instrument Sans is dormant comparison code). A font swap to silence a generic
detector would reopen an accepted decision. These are disclosed, not hidden by
an ignore rule or treated as a clean detector pass. No new font was introduced.
The final [detector report](evidence/cross-frontend/detector.json) records exit 2:
9 warnings and 7 advisories (inherited-font warnings and dormant comparison /
sample-control token coverage). There are no findings in AccountSamples.tsx.
These findings remain disclosed; the detector is not reported as passed.

## Independent review

The independent finish reviewer inspected the direction contract, connected
implementation, new segmented screenshots, and route/state verification.
The first disposition was **fix** for four material behavior defects:

| Finding | Correction and regression check |
| --- | --- |
| Long Daily Edit opened not-found | Seeded backing tasks instead of rendering an action-only fixture; prefill/save/Complete/Delete now tested |
| New account inherited fixture histories | Both histories honor new-account state; empty Daily and Expedition histories verified after signup |
| Sign-in lost date/filter scope | Preserved destination search except `session`; return date/status verified |
| Stale quote said ready beside disabled Launch | Guidance and action share the stale readiness gate; unavailable text and retry recovery verified |

After one correction batch and fresh captures, the reviewer independently
rechecked all four fixes in Chromium at 320, 390, 768 and 1440px and scored
**all four resolved**, disposition **ship at targeted verdict-pass scope**.
This is not a second whole-surface audit, human acceptance, production approval,
or permission to close #275 on the user's behalf. The initial review found no
visual rebuild necessary for the inspected After hours evidence.

The final cross-frontend suite additionally passed retained Daily save-rejection
and exactly-once synthetic delayed-reward reconciliation assertions. Their
results are in `evidence/cross-frontend/verification.json`; the reviewer inspected
those assertions but did not independently rerun those two additional checks.

## Remaining external approval and limits

No real account, deletion, server validation, live countdown, async event
delivery, token security, API pagination or screen-reader certification is
claimed. Boundary screens are synthetic presentations, not proof of the
production router's error handling. These limits do not hide a missing route;
they bound what a disposable frontend prototype can establish.

For user review:

1. Does the selected identity remain useful across account forms, Profile,
   histories, outcomes and failure/recovery—not just the original core loop?
2. Are mobile task density, long content and the native/dialog focus behavior
   comfortable at 320px as well as desktop?
3. Do the explicit delayed/stale/preparing messages explain what remains usable
   and what is waiting, without implying that unconfirmed materials can be spent?

If a material mismatch remains, record a focused prototype decision or reopen
convergence. Do not interpret browser checks, reviewer disposition, or this
document as the user's cross-frontend approval.
