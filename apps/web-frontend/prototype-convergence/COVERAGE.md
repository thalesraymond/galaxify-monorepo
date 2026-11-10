# Cross-frontend prototype coverage (work in progress)

This is a disposable synthetic prototype, not a production implementation. The
route inventory is based on `src/app/routes.tsx`; a route being listed does not
mean it has been visually or accessibly reviewed.

| Production route or boundary | Prototype coverage | Remaining work |
| --- | --- | --- |
| `/` | Dashboard sample | Real authentication redirect not modeled |
| `/dashboard` | Existing convergence flow | Recheck responsive and difficult states |
| `/dailies`, `/dailies/history` | Existing samples | Recheck empty, loading, error, and long content |
| `/dailies/new`, `/dailies/:dailyId/edit` | Existing form, canonical edit path | Validate errors, deep links, unsaved changes |
| `/ship` | Existing damaged Ship and repair | Recheck unavailable and delayed states |
| `/expeditions` | Existing launch flow | Recheck availability and delayed states |
| `/expeditions/history` | Initial synthetic history | Empty, loading, error and long content |
| `/expeditions/:expeditionId` | Initial synthetic success result | In-flight, failure, delayed result and missing ID |
| `/signup`, `/login` | Not modeled | Forms, validation, authentication states |
| `/profile` | Not modeled | Profile and account actions |
| Protected `*` | Prototype-unavailable fallback | Production-like not-found and navigation behavior |
| `/__design-system-preview` | Not modeled | Developer-only surface, outside player journey; document treatment |
| Auth redirects, bootstrap, route fallback, error boundaries | Not modeled | Loading, failures, retry and navigation |

All responsive, reduced-motion, keyboard, focus, and accessibility checks for
the new routes remain outstanding. The prototype has not been approved for
cross-frontend reach.
