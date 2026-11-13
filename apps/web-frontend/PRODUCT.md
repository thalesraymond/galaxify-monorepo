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
and route inventory live in [`docs/specs/web-frontend.md`](../../docs/specs/web-frontend.md),
and delivery gates live in [`docs/specs/web-frontend-delivery.md`](../../docs/specs/web-frontend-delivery.md).
Daily completion is optimistic; repair and launch await confirmation. Downstream
game updates may be delayed: last confirmed facts and local Retry must remain honest.
No backend changes or new mechanics are part of the visual redesign.

## Brand Commitments

Preserve the Galaxify name and canonical terminology. The approved production
visual direction is **After hours** with Assembly's top navigation and a
spacecraft-shaped detailed Ship hull mosaic, approved by the driving user in
[`#276`](https://github.com/thalesraymond/galaxify-monorepo/issues/276) and
scheduled across [`#285`](https://github.com/thalesraymond/galaxify-monorepo/issues/285).

## Evidence on Hand

The product spec, production routes, deterministic mocks under `src/mocks`,
visual-regression suites, the approved identity/convergence prototypes at
commits `2e7dc37` and `dca3e21`, and the governing redesign specification in
[`docs/specs/frontend-redesign.md`](../../docs/specs/frontend-redesign.md).

## Accessibility & Inclusion

WCAG 2.2 AA, keyboard access, visible focus, reduced motion, and 320px reflow.
States must not rely on color alone. Desktop and mobile have equal priority.

## Confirmation

Visual direction and implementation handoff confirmed by the driving user in
[`#276`](https://github.com/thalesraymond/galaxify-monorepo/issues/276) on
2026-11-10.
