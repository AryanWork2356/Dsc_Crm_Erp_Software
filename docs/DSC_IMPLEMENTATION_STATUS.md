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

## Batch 2A – manpower, feasibility, launch, tasks (done, 345 tests pass)
- **Manpower** (`/resources`): needs by project, trade and dates (required / confirmed / vendor / backup), a confirmed headcount needs a note saying who confirmed it; supervisors record per trade how many were planned and how many came (reason required when fewer or late); a short crew raises ONE action for the resource coordinator (named in settings, else the project manager) and closes itself when corrected; shortages that are close or started are raised automatically (also by the daily job) and close themselves when covered; vendors have First choice / Backup / Emergency, trades and crew size, over-commitment is flagged, and reliability (came ÷ planned, on time ÷ came) is computed from the records only, shown after 5 recorded days.
- **Feasibility check** before accepting a job (8 questions) on every quotation and **launch checklist** (11 steps, Day 0 to Day 3, extra days for out-of-city jobs) on every project (`/feasibility/quotation/…`, `/feasibility/project/…`, buttons on both pages). Confirming a question needs a written note (who, how). Only Owner/Management/Admin decide: Accept / Accept with conditions / Renegotiate or decline. Accepting with open questions is a recorded **exception** (why, who accepted, close-by date) and raises one action per open question. A launch step past its date (+12 h grace) is chased through the Time Limits board.
- **Tasks**: area/zone, planned and actual quantity and unit, trade and people needed, block reason, area released to the next trade; a written status rule (Complete / Blocked / Delayed / At risk / On track, `lib/task-health.ts`); blocking a task raises one action for the project manager and unblocking closes it.
- Menus: Manpower added to the supervisor, engineer, project manager, management and admin menus.

Company decisions needed: the extra days for out-of-city jobs (now 2), the 3-day look-ahead for crew shortages, who the resource coordinator is.

## Batch 2B – deliveries, waste, extra work (done, 354 tests pass)
- **Late deliveries** (Procurement → Deliveries): each PO line has a need-by date and the supplier's latest promised date (falling back to the order's delivery date). *Late* = the promise has passed; *too late* = the promise is after the day the site needs it. Each raises ONE action for procurement (and tells the project manager), needs a reason (our late request / supplier / transport / drawing change / site access / other / not known) and a recovery plan, and closes when the material arrives or the dates are corrected.
- **Waste and reconciliation** (`/inventory/waste`): record waste, damage, supplier damage, rework or a reusable offcut with a reason and a named person to find out why (an action is raised). Everything except an offcut leaves the stock (refused if the location does not have that much); an offcut stays in stock. Per project and material the page shows issued − returned − waste − still at site = used, all from stock records.
- **Extra work**: kinds Chargeable / Included in the contract / Emergency / DSC's own rework / Concession; scope check; DSC's own cost and margin, schedule impact; included work and own rework can never carry a price; emergency work and concessions need a director (someone other than the person who raised it) before they start; emergency work then keeps an action open until the client's written approval is recorded; completed work is verified by the project manager; Accounts links the invoice it was billed on (emergency work cannot be linked until the client's approval is on record). Exceptions page shows emergency work without approval and finished work not on an invoice.

Company decisions needed: the day-count rules are written in `lib/delivery-risk.ts` and `lib/readiness.ts`; who may approve concessions (now Owner, Management, Admin).
