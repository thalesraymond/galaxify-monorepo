## 2026-03-31 - Standardizing UI Buttons for Focus Visible Consistency
**Learning:** Raw HTML `<button>` elements across pages (such as retry buttons in footer/error states) lack standard `:focus-visible` styling, active state transforms, and consistent design system variable usage unless wrapped by the shared `Button` component or given standard focus styles.
**Action:** Prefer using the shared `Button` component (with standard variants like `secondary`) over raw `<button>` elements for standard actions, ensuring keyboard navigation and visual polish remain uniform.
## $(date +%Y-%m-%d) - Add aria-label to repetitive edit links
**Learning:** Repetitive "Edit" links in list rows (like Daily rows) lack context for screen reader users, who hear "Edit, link" repeatedly.
**Action:** Always add an `aria-label` specifying the target of the action (e.g., `aria-label={"Edit " + daily.title}`) to disambiguate identical link text within lists.
