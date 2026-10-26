# DSC Interior ERP – baseline of 26 October 2026

This file describes the app **exactly as it stands before the company's process changes**. If a change goes wrong, this is the version to go back to.

- **Git tag:** `baseline-2026-10-26` (commit `278836b`, branch `main` at that moment). A branch called `backup/baseline-2026-10-26` points at the same commit.
- **Live site:** https://dsccrmsoftw.vercel.app (Vercel, region Singapore, auto-deploys from `main`).
- **Database:** Neon PostgreSQL (hosted), local copy on embedded Postgres port 5434 (`dsc_erp`; tests use `dsc_erp_test`).
- **Tests at this point:** 34 files, 320 tests, all passing. `tsc` and `eslint` clean. Production build succeeds.

## How to go back to this version

Code only (the database keeps whatever it holds):

```
git fetch --tags
git checkout baseline-2026-10-26        # look at it
git switch -c restore-baseline          # work from it
```

To make `main` equal to the baseline again (only if you really want to throw the later work away; keep a copy first):

```
git switch main
git branch backup/before-reset          # keep the newer work safe
git reset --hard baseline-2026-10-26
git push --force-with-lease origin main
```

Database: new tables or columns added after this point stay in the database (they are harmless to the old code). To keep a copy of the data **before** a big change, run `npm run data:backup` (this computer) or `npm run data:backup-hosted` (online; it asks for the Neon address). It saves every table to `D:\DSC_Crm_Softwackups\<date-time>\` and changes nothing. To bring a copy back: `npm run data:restore -- "<folder>"` (or `data:restore-hosted`).

## What the app is

Interior design and turnkey execution ERP + CRM for DSC Interior Pvt. Ltd. (Thane / Mumbai). Next.js 15 (App Router, server actions) + TypeScript + Tailwind 4 + Prisma 6 + PostgreSQL. Multi-tenant (`companyId`). 71 database models, 17 migrations, about 30 screen groups. Installable on phones (PWA); Capacitor Android/iOS shell in `mobile/` (not built or published).

## Roles (15)

OWNER, MANAGEMENT, ADMIN, SALES (hidden), PROJECT_MANAGER, DESIGNER, PROCUREMENT, ACCOUNTS, HR, STORE, SITE_ENGINEER, SITE_SUPERVISOR, WORKER, VENDOR, CLIENT. Permissions are a matrix in `src/lib/permissions.ts`; row scope in `src/lib/scope.ts`; each role has a short menu (`SIMPLE_MENU` in `src/lib/nav.ts`). Cost, profit and client rates are visible only to Owner, Management, Project Manager and Accounts. Only Owner/Admin create users and portal logins. Only Owner/Management/Admin approve quotations and convert them to projects.

## Features in this baseline

- **Sales:** clients, site visits, BOQ with measurement sheets (feet/inches, deductions), import of a client's own Excel BOQ (any layout, scope-headed sheets, material and HSN/SAC codes, hidden and measurement sheets unticked), per-client rate cards with profit % and "use the same as last time", quotation with payment-term presets, GST (CGST/SGST/IGST), client PO number/date and vendor code, quotation Excel (letterhead, or the client's own layout: cover page + one sheet per scope) and PDF, approvals, revisions and compare.
- **Projects:** project from an accepted quotation, milestones with bill %, tasks, documents, site location, status flow, daily site reports (morning/evening with photos, escalation), transfers (material/manpower), extra work locked until client approval, vendor-bill certification, closure checklist (15 items) with report, scorecards, director weekly/monthly reports.
- **Procurement and stock:** purchase requests (2-day notice rule), purchase orders, vendors, deliveries and receipts with challan photo, issues and returns, stock ledger, locations.
- **People:** employees, leave policy, advances recovered in payroll, payroll and payslips, workers with phone login, attendance (manual by supervisor/HR, self-marked only within the allowed distance of the site or office; default 20 m, settings in Admin).
- **Finance:** invoices (also from milestones), payments, receivables ageing by client, vendor bills and payments, expenses, GST sales register.
- **Platform:** Time Limits board (12 rules), notifications, audit log, search, documents (database or S3 storage), PWA, first-run company setup, screen language switch (Hindi / Marathi / Gujarati by browser translation), friendly error screens, data backup/clear/restore tools, client/vendor portal logins.

## Switched off on purpose (switches in `src/lib/features.ts`, all `false`)

`USE_CONTRACTORS` (outside labour contractors: menu, worker field), `USE_LEADS` (Leads and Follow-ups menu), `USE_SALES_TEAM` (Sales role not offered for new people). Nothing was deleted; set to `true` and redeploy to bring any back. Carpenters, electricians and painters are entered as vendors.

## Known gaps at this baseline (not built)

- A client PO is only a number and date on the quotation: there is no PO record, PO amount, PO file, invoice-to-PO link or per-PO balance.
- No two-step login; the login rate limit is per server instance.
- No e-mail or WhatsApp sending connected; offline saving of reports, push notifications, voice notes, snag list with photos, QR attendance, Tally export are not built.
- The "Benchmarked rate" column of the Louis Philippe sprinkler sheet is read but not used.
- Quantities are stored to 3 decimals, so a client's unrounded totals can differ by a few paise.

## State of the data

Demo data was cleared on 19 October 2026 (local and hosted). Kept: the company and its settings, permissions, terms templates, and the 16 staff logins (placeholders such as `owner@dsc.demo`, password `Demo@1234`; Client, Vendor and Worker logins were removed). Saved copies of the demo data are in `D:\DSC_Crm_Softw\backups\` (three folders). Real company details, real people and the Neon password reset are still to be done by the company.

## Documents

`docs/` (WORKFLOWS sections 1–32, GO_LIVE, ARCHITECTURE, DATABASE, ROLES_AND_PERMISSIONS, user guides). PDF guides in `D:\DSC_Crm_Softw\Dsc_app\guides\`: App Guide (English, Hinglish) and Full Fledged Process (English, Hinglish; the Full Fledged ones were last rebuilt before contractors, leads and the Sales role were hidden and before the client-layout export, and need a refresh).

## Environment variables (Vercel)

`DATABASE_URL` (pooled), `DIRECT_URL`, `AUTH_SECRET`, `CRON_SECRET`, `STORAGE_DRIVER` (`db`), `APP_URL`. A daily cron calls `/api/cron/daily`.
