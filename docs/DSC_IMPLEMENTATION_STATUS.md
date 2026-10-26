# Implementation status (branch `process-changes`)

Return point: tag `baseline-2026-10-26`. Plan: `docs/DSC_IMPLEMENTATION_PLAN.md`. Audit: `docs/DSC_APP_AUDIT.md`.

## Batch 1 – foundation (done, 333 tests pass)
- **Four workspaces** in the menu: Site & Projects, Commercial & Operations, Finance & People, Management & Growth (plus Dashboard, Actions & Blockers, Approvals, Time Limits, Documents, Notifications, Admin). Same pages, new grouping.
- **Actions & Blockers** (`/actions`): owner, due date, severity, status, project, source; start / done (written result) / change owner or date (reason) / cancel. Raised by people or by the app itself (`lib/action-items.ts`, once per source). Late ones are chased by the Time Limits rule `action_overdue` (critical = overdue at its time, high = 6 h earlier): owner, then project manager, then directors, once each.
- **Baseline dates**: the first project end date and task due date are kept forever; any later change needs a written reason and is logged (`DateChange`). Project and task screens show "moved +N days (first date …)".
- **Exceptions page** (`/exceptions`): projects with no manager / budget / date / recent daily report, past completion, moved dates, late milestones, moved tasks, approvals waiting, serious or late actions, other time-limit items, overdue receivables and bills awaiting certification (the last two only for finance). Definitions are printed on the page.
- A person not named on any project now sees why (Daily site reports).
- Dashboard "Needs you" card with the person's own open actions.

Company decisions needed: none new in this batch.
