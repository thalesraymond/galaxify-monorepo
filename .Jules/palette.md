## 2026-03-31 - Standardizing UI Buttons for Focus Visible Consistency
**Learning:** Raw HTML `<button>` elements across pages (such as retry buttons in footer/error states) lack standard `:focus-visible` styling, active state transforms, and consistent design system variable usage unless wrapped by the shared `Button` component or given standard focus styles.
**Action:** Prefer using the shared `Button` component (with standard variants like `secondary`) over raw `<button>` elements for standard actions, ensuring keyboard navigation and visual polish remain uniform.
