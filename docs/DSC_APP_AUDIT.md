# DSC Interior app – audit (26 October 2026)

Verified by reading the code and running it, on the baseline `baseline-2026-10-26` (commit `278836b`). "Verified" means I saw the code path from screen to server action to database and a test passes for it.

## 1. Stack and architecture (verified)

Next.js 15 (App Router, server actions) · TypeScript · Tailwind 4 · Prisma 6 · PostgreSQL (Neon hosted, embedded Postgres locally) · Vercel (Singapore) · PWA · Capacitor shell (not published). Multi-tenant by `companyId`. 71 models, 17 migrations, 34 test files / 320 tests (real database, real server actions), `tsc` + `eslint` clean, production build passes.

Authorization: a role/permission matrix (`lib/permissions.ts`, 38 modules × 7 actions + special keys), row scope for projects/clients (`lib/scope.ts`), and every server action calls `assertPerm(...)`. Route handlers (PDF/Excel/download) check the session themselves. Sessions are signed httpOnly cookies; passwords bcrypt; login rate limit is per server instance (weak on Vercel). Every important change writes an audit-log row (`lib/audit.ts`).

## 2. Module inventory

| Area | State | Notes |
|---|---|---|
| Clients, site visits | Working | Leads / follow-ups built but **switched off** by company decision |
| BOQ, measurement sheets, client-Excel import, rate cards | Working | Tested on 4 real client workbooks |
| Quotation (versions, approval, PDF, Excel in client layout), client PO no./date | Working | The PO is only a number+date: **no PO record, amount, file or invoice link** |
| Projects, milestones (bill %), tasks, documents, status | Working | Tasks have one due date and one dependency id; **no baseline date, zone, quantity or trade** |
| Daily site reports (morning/evening, photos, lateness, escalation) | Working | Manpower is a single total, **not by trade, not planned vs present** |
| Time Limits board (12 rules) + notifications with de-duplication | Working | No rule for crew shortage, late delivery, overdue action |
| Material request → PO → receipt (challan photo) → issue → return, stock ledger, transfers | Working | **No ETA per PO line, no delay reason, no waste/offcut record, no reservation, no cycle count** |
| Vendors, vendor bills (certification before payment), vendor payments | Working | **No advances/recovery, no duplicate-invoice check, no PO/bill mismatch check, no bill extraction** |
| Contractors, work orders, contractor payments | Built, **switched off** | Work orders point at *contractors*, not vendors; no certified progress, advance or settlement |
| Extra work (client approval lock, portal approval) | Working | No in-scope check, cost/time impact, internal approval step, billing link or concession type |
| Project cost: budget vs actual (material, labour, vendor, other) | Working | **No committed cost, no estimate-to-complete, no forecast final cost** |
| Invoices, payments, receivables ageing | Working | **No follow-up log (promised date, next action, owner)**; no invoice↔PO link |
| Expenses (approval, verification) | Working | No travel/transfer fields (from/to, who moved, allocation rule) |
| Attendance (manual, self-mark within 20 m), leave, payroll, advances | Working | |
| Closure checklist, scorecards, director reports, GST register | Working | |
| Approvals engine with limits and optional role override | Working | |
| Navigation | Works, **too many groups** (CRM, Sales, Projects, Procurement, Inventory, Workforce, HR, Finance, Admin…) | Short per-role menus exist (`SIMPLE_MENU`) |
| Management dashboard | Owner dashboard has money/projects/alerts | **No exception view** (late milestones vs baseline, missing owner/budget/schedule, forecast variance, crew/material risks) |
| Feasibility / capacity check, 3-day launch checklist | **Missing** | |
| Resource (manpower) board, vendor tiers, reliability score | **Missing** | |
| Action / blocker register | **Missing** (tasks exist but are project work, not blockers/actions with severity, source and escalation) | |
| Bill/document extraction (OCR) | **Missing – and cannot be verified here** (needs an external service and credentials) | |
| E-mail / WhatsApp sending, Tally | **Not connected** | Screens exist for WhatsApp setup only |

## 3. Disconnected or weak links (ranked)

1. A client PO is not a record, so invoices, receivables and "what is left to bill" cannot be tied to it.
2. Planned dates can be overwritten with no baseline; late work then looks on time.
3. Manpower is one number per report: carpenter shortage cannot be seen, tracked or scored.
4. Forecast final cost does not exist; overruns show only after cost is booked.
5. Late deliveries are invisible (no promised date on PO lines).
6. Waste and offcuts are not recorded; stock differences have nowhere to go.
7. Vendor advances and recoveries are not tracked; a bill can be paid twice for the same invoice number.
8. Blockers live in WhatsApp; nothing has an owner, severity, due date and escalation.

## 4. UX problems (ranked by user impact)

1. Menu groups follow the database, not the work (nine groups); the brief wants four workspaces.
2. A supervisor opening the app with no project sees nothing and no explanation (fixed in guides, not in the app: should say "you are not named on any project").
3. Several forms ask again for what is already known (project, vendor) – mostly fine, but the PO/receipt/bill chain should prefill from the PO.
4. No single place to see "what needs me today" across approvals, actions, deliveries and blockers.

## 5. Security and data-integrity risks (ranked)

1. **High:** login rate limit is in memory per instance. Fix: database-backed counter.
2. **High:** no two-step login for Owner/Accounts. Needs a company decision (authenticator app).
3. **Medium:** Neon password was exposed in chat; must be reset by the company.
4. **Medium:** Google Translate sends page text to Google (finance screens); documented, opt-in only.
5. **Low:** quantities stored to 3 decimals (paise-level differences from client sheets).
6. No destructive endpoint without a permission check was found. Money records are never hard-deleted except drafts. Stock cannot go negative (verified by test).

## 6. Keep / improve / combine / hide / add

- **Keep** everything that works (list above) and the baseline tag as the safe return point.
- **Combine** navigation into four workspaces: *Site & Projects*, *Commercial & Operations*, *Finance & People*, *Management & Growth* (+ Admin, Notifications). Same pages, new grouping.
- **Hide (already, by company decision):** leads pipeline, contractors, Sales role. Kept in code behind `lib/features.ts`.
- **Improve:** tasks (baseline, zone, quantity, trade), daily report (manpower by trade), PO lines (ETA, delay reason), extra work (assessment + approval + billing link), project finance (committed + forecast), receivables (follow-ups), expenses (travel), bills (duplicate and arithmetic checks).
- **Add:** action/blocker register, exception dashboard, feasibility + launch checklist, resource board with vendor tiers and reliability, delivery-risk alerts, waste records, client PO record, vendor advances.
- **Not claimable now:** OCR/bill extraction, e-mail/WhatsApp delivery, Tally sync, production deployment of anything not tested.
