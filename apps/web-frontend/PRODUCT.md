# Galaxify

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Players managing recurring habits on desktop and mobile. Specific demographic
claims and usage frequency have not been established.

## Product Purpose

Complete recurring Dailies and turn that routine into Ship progression: inspect
hull and materials, repair the Ship, and invest materials in an Expedition.
Habit completion stays immediate; game progression rewards rather than obstructs it.

## Capabilities and Constraints

Canonical product nouns are Player, Daily, Ship, and Expedition. Existing mechanics
and the React/TypeScript/Vite/CSS Modules stack stay. The authoritative behavior
and route inventory live in `../../docs/specs/web-frontend.md`.
Daily completion is optimistic; repair and launch await confirmation. Downstream
game updates may be delayed: last confirmed facts and local Retry must remain honest.
No backend changes or new mechanics are part of the identity exploration.

## Brand Commitments

Preserve the Galaxify name and canonical terminology. The existing visual identity
is not binding for the redesign. No replacement direction is approved yet.

## Evidence on Hand

The product spec, production routes, deterministic mocks under `src/mocks`,
existing visual-regression captures, and the approved identity-discovery map:
https://github.com/thalesraymond/galaxify-monorepo/issues/271.
Comparison prototypes use explicitly synthetic data, not real player accounts.

## Accessibility & Inclusion

WCAG 2.2 AA, keyboard access, visible focus, reduced motion, and 320px reflow.
States must not rely on color alone. Desktop and mobile have equal priority in
prototype comparisons.

## Confirmation

Confirmed by the driving user in the prototype session on 2026-11-01. This record
captures product truth only; it does not approve any visual alternative.
