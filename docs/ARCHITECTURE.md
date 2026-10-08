# Architecture

## 1. What we built and why we chose it

| Choice | Why |
|---|---|
| **One web app, not separate apps** | DSC's pain is disconnected tools (WhatsApp + Excel + Drive + accounts). One codebase and one database means a material added to a BOQ can become a purchase request, a received delivery updates stock, and an issued item changes project profit – with no copy-paste. |
| **Next.js (App Router) + TypeScript** | Pages render on the server next to the database, so screens are fast on slow site phones, and the same language is used front-to-back. TypeScript catches whole classes of mistakes before they reach users. |
| **Server Actions instead of a separate REST API** | Every button calls a typed server function. Fewer moving parts, no API/UI drift, and Next.js adds same-origin (CSRF) protection. |
| **PostgreSQL + Prisma** | A relational database is the right tool for money, stock and approvals (transactions, constraints, row locks). Prisma gives type-safe, injection-proof queries and versioned migrations. |
| **Tailwind + a small in-house design system** (`src/components/ui`) | Consistent, light, fast; no heavy UI framework to maintain. |
| **Zod** | One validation definition per form, run on the server (the only place that counts). |
| **pdfkit / exceljs / Recharts** | PDFs and Excel are produced on the server from the same data as the screens; charts are client-side. |
| **Vitest on real code + real DB** | Tests call the actual server actions against a real PostgreSQL test database, so a green test means the real workflow works. |

## 2. Layers

```
Browser  ──►  Page / Route handler (server)  ──►  Server Action (server)  ──►  lib/* domain logic  ──►  Prisma  ──►  PostgreSQL
              reads data, renders             validates (zod), checks         approvals, inventory,
                                              permission + scope, audits      money, payroll, reports…
```

1. **Authentication** (`src/lib/auth.ts`, `session.ts`, `middleware.ts`) – signed JWT cookie → user re-loaded from the DB every request (`getCtx`). Middleware only does a cheap redirect for signed-out visitors; real checks happen server-side.
2. **Authorization** has two parts:
   - *Permission* (`permissions.ts`): `module:action` keys per role – "may Sales create quotations?"
   - *Scope* (`scope.ts`, `doc-access.ts`): which **rows** – "only leads assigned to me", "only projects I'm on".
   Pages call `requirePerm()`; actions call `assertPerm()`; both return a context carrying `companyId`, role and `can()`.
3. **Actions** (`app/**/actions.ts`) – each wraps its body in `run()` (`lib/action.ts`) which turns validation, permission and business-rule errors into messages the UI shows as toasts or field errors. Nothing fails silently.
4. **Domain libraries** in `src/lib` hold the rules that must be identical everywhere:
   - `money.ts` – the only place totals/GST/discount are computed (the server always recomputes; browser numbers are display only).
   - `approvals.ts` + `approval-handlers.ts` – the approval engine.
   - `inventory.ts` – the stock ledger.
   - `project-finance.ts` – live project profit.
   - `finance-stats.ts`, `aging.ts`, `dashboard.ts`, `reports.ts` – company numbers (one definition, reused by every screen).
   - `payroll.ts`, `automation.ts`, `whatsapp.ts`, `pdf.ts`, `storage.ts`, `crypto.ts`.

## 3. Key design decisions

### Multi-tenancy
Every business table has `companyId`; every query includes it. Today there is one company (DSC); adding another is just another `Company` row with its own users. `Sequence` gives each company its own numbering.

### Approvals (`lib/approvals.ts`)
A document asks for approval with an amount → the engine decides *which role* must approve from the configurable limits → notifies those people → on decision calls the document's registered handler (quotation → Approved, PO → Approved, invoice → Issued…). Rules: nobody approves their own request (except the Owner), a Project Manager approves only projects they manage, and a requester with enough authority is auto-approved (audited). New document types plug in by registering one handler.

### Stock is a ledger (`lib/inventory.ts`)
Quantities are never typed in. Receiving, issuing, returning, transferring, correcting, damaging and consuming each create an `InventoryTransaction` and move `StockBalance` in the **same database transaction**. Removing stock is a single atomic SQL `UPDATE … WHERE quantity - reserved >= qty`, so two people can never take the last units. Cost uses a moving average; project material cost is recognised when stock is *issued to* (or delivered *at*) the project site.

### Live project profit (`lib/project-finance.ts`)
Never stored – computed from real records on demand:
`Profit = contract value (ex-GST) − material (issues + site deliveries + material expenses) − labour (attendance wages + labour expenses) − vendors (non-PO bills + contractor payments + vendor expenses) − other approved expenses`. Budget comes from the project's current BOQ.

### Dates
Calendar-day columns (attendance) use `calendarDay()` (UTC midnight of the intended date) so values never shift with server timezone.

### Documents & files
Uploaded files live outside the web root and are only served by `/documents/[id]/download`, which re-checks the user's access to the record the file belongs to. Portal users only see files explicitly shared.

### Portals
Client, vendor and worker screens are separate route groups with their own layouts and **their own server actions** that accept only the signed-in party's data; they never reuse staff actions. PDF/download endpoints re-check ownership.

### Automation (`lib/automation.ts`)
Time-based rules (expire quotations, overdue invoices, follow-ups, late deliveries, deadlines, expiring documents…) are idempotent via `Notification.dedupeKey`, so they can run from cron, on first dashboard load of the day, or from a button, any number of times. Event-based rules live beside the action that fires them.

### Audit (`lib/audit.ts`)
`audit()` is called inside the same transaction as the change it records. The table has no update/delete code path.

## 4. Request lifecycle example – "Record payment"

1. Accounts clicks *Record payment* → `FormDialog` posts to `recordPayment` (a server action).
2. `assertPerm("payments:create")` → rejects if the role can't.
3. Zod validates the form. In one DB transaction: lock the invoice row (`SELECT … FOR UPDATE`), check the amount ≤ balance, insert the payment, recompute `paid`/`status` from the payments table, write the audit entry.
4. Result → toast; the page refreshes; project outstanding, receivables, dashboard and reports all read the same rows, so they update together.

## 5. Testing

- `tests/*.test.ts` – 177 tests on money maths, payroll, ageing, approvals, every module's workflow, concurrency (simultaneous issues/payments), permissions, portal isolation, webhook security, reports and dashboard consistency.
- `scripts/smoke.ts` – ~300 checks of real pages, redirects, PDFs, Excel and downloads for different roles against a running server.
- Global test setup builds a fresh `dsc_erp_test` database from the migrations and seed every run.

- `tests-perf/` (`npm run perf`) – builds a database with 10k leads / 10k tasks / 100k stock movements / 100k attendance rows and fails if any heavy screen takes ≥ 1.5 s. It caught (and we fixed) an attendance report that loaded 100k rows into memory; totals are now computed in SQL.

## 6. How to extend

| Task | Where |
|---|---|
| Add a module | `prisma/schema.prisma` → migration → `app/(app)/<module>/{actions.ts,page.tsx}` → permission keys in `permissions.ts` → entry in `lib/nav.ts` → tests |
| New approval type | add to enum, `registerHandler()` in `approval-handlers.ts`, call `requestApproval()` from the action |
| New report | add an object to `REPORTS` in `lib/reports.ts` (list + CSV/Excel/PDF export come free) |
| New notification channel (email/SMS) | extend `lib/notify.ts` |
| S3 file storage | reimplement `lib/storage.ts` |
| New automation rule | add a block to `runDailyAutomations` with a `dedupeKey` |
