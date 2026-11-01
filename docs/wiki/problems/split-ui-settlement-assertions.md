---
type: problem
created: 2026-11-01
updated: 2026-11-01
sources:
  - "galaxify-monorepo@0906a5e"
  - "PR #264, coverage-mode CI"
---

# Related UI facts settle in separate commits

On 2026-11-01, `DailyFormPage.test.tsx` intermittently failed only in coverage
mode: a created Daily's heading was found and focused, but `aria-current` was
still absent when the next line asserted it. Focus and the current-row marker
can settle in separate React commits under load, and a `findBy*` query resolves
before either is guaranteed.

The fix is to wait for every related fact in one `waitFor`, not to assert one
and then immediately check the other:

```ts
await vi.waitFor(() => {
  expect(row).toHaveFocus()
  expect(row).toHaveAttribute('aria-current', 'true')
})
```

A flake that only appears under coverage is still a real gate failure; fix the
test's settlement boundary rather than retrying CI. This is distinct from the
[fake-timer freeze](fake-timers-freeze-bounded-observations.md), which is about
a clock that never advances.
