# DSC Interior – implementation plan

Source: *DSC Interior Operating System Notes* (PDF) and the master prompt. Method: small batches on the branch `process-changes`; each batch = migration (additive only) + code + tests + docs, merged to `main` only when the whole suite, `tsc`, `eslint` and the build pass. Return point: tag `baseline-2026-10-26`.

Rules kept throughout: nothing existing is deleted; every new money/approval record keeps who/when; permissions enforced on the server; thresholds and percentages are **settings, not hard-coded** (marked "needs company approval"); no fake values on live screens.

## Phase 1 – foundation and usability

| # | Task | Acceptance |
|---|---|---|
| 1.1 | Four workspaces in the navigation (same pages, new grouping, plain names) | Every existing page reachable; per-role menus unchanged in size; menu test passes |
| 1.2 | **Action / blocker register**: owner, due date, severity, status, source (project / record), resolution; overdue → owner, then manager, then directors, once each | Create, resolve, escalate once, no duplicate alerts; visible on the project and in "what needs me" |
| 1.3 | **Baseline dates**: first committed project end date and task due date are kept; any later change needs a reason and is logged (who/when/old/new) | Changing a date without a reason is refused; the baseline never changes; late vs baseline shown |
| 1.4 | **Exception dashboard** for management: projects with no owner / budget / schedule / recent update, milestones late vs baseline, overdue approvals, open critical actions, overdue receivables, bills waiting; each row links to the record | Numbers equal the source records (tests); no sample data |
| 1.5 | Plain message when a person has no assigned project | Supervisor/engineer/PM with none sees why and what to do |

## Phase 2 – planning, manpower, materials

| # | Task | Acceptance |
|---|---|---|
| 2.1 | **Feasibility check** (scope, commercial, manpower, vendors, materials, factory, schedule, risk) with decision Accept / Accept with conditions / Renegotiate-decline, approver and recorded exception; **3-day launch checklist** with owner, due date, confirmed date | Decision needs an approver; exception stores risk + resolve-by; missing items are listed overdue |
| 2.2 | **Tasks**: zone, planned/actual quantity and unit, required trade and headcount, blocked reason, zone release; status On track / At risk / Delayed / Blocked / Complete with written rules | Rules tested; baseline kept |
| 2.3 | **Resource board**: need by project/trade/dates vs confirmed vs actual present (recorded per trade by the supervisor), vendor tiers (primary / backup / emergency), shortage alert + auto action, vendor reliability from real records | Shortage creates one alert and one action; reliability = present ÷ planned from logs |
| 2.4 | **Delivery risk**: need-by and promised ETA per PO line, delay reason codes, recovery action, late/at-risk board, de-duplicated alerts to procurement and PM | Late line alerts once, resolution closes it |
| 2.5 | **Waste and reconciliation**: record waste/offcut/damage with reason and cost; per project and material: received, issued, returned, waste | Quantities balance; negative stock still refused |
| 2.6 | **Extra work** assessment: in original scope?, type (chargeable / included / emergency / own rework / concession), cost and schedule impact, internal approval, billing link; "started without approval" flag | Own-rework cannot be charged; concession records its value and approver |

## Phase 3 – commercial and finance

| # | Task | Acceptance |
|---|---|---|
| 3.1 | **Forecast final cost** = actual booked + remaining unbooked commitments + estimate still needed, with definitions on screen; PO not double-counted when received/billed | Test: PO then receipt then bill gives one cost |
| 3.2 | **Client PO** record (number, date, amount, scopes, file), invoices tied to a PO, **account page per company** (quoted, PO, billed, received, left to bill, left to collect), **collection follow-ups** (promised date, next action, owner) | A promised payment never marks an invoice paid |
| 3.3 | **Vendor advances and recovery**, vendor work orders with certified progress and settlement | advance + certified work + bill + part payment + recovery reconcile |
| 3.4 | Bill checks: duplicate vendor + invoice number, arithmetic, PO/receipt mismatch warnings; distinct verified / approved / paid states | Duplicates refused unless explicitly resolved |
| 3.5 | Travel / site-transfer expense fields and allocation (project or overhead – **policy needs company approval**) | |
| 3.6 | Bill/document **extraction**: **not built** – needs an external service and credentials; the screen stays manual with the checks above | Documented as blocked |

## Phase 4 – management, CRM, scale

KPI page with the formulas written next to each number (on-time milestones, plan reliability, material readiness, carpenter availability, forecast variance, unapproved extra work, billing turnaround, overdue receivables). Gross margin by project from existing finance data; **EBITDA only after finance defines it** (shown as "needs definition" until then). CRM pipeline stays off until a sales team exists (switch `USE_LEADS`).

## Needs the company (not decided by me)

Approval limits in rupees; payment percentages per vendor type; cost-allocation policy for travel and shared costs; EBITDA and direct-cost definitions (accountant); which projects pilot the app; real people and roles; Tally approach; whether bill extraction is wanted and from which service.

## Status

Updated at the end of each batch in `docs/DSC_IMPLEMENTATION_STATUS.md`.
