# DSC Interior ERP + CRM

One connected system for an interior design & turnkey execution company: **enquiry → site visit → quotation → approval → project → purchasing → stock → site labour → billing → profit.**

Built for DSC Interior Pvt. Ltd. (Thane / Mumbai), designed so other interior firms can be added later (every record belongs to a `company`).

| | |
|---|---|
| **Type** | Web application (desktop, tablet and phone browsers). Workers, clients and vendors get simplified screens. |
| **Stack** | Next.js 15 (App Router, Server Actions) · TypeScript · React 19 · Tailwind CSS 4 · PostgreSQL · Prisma 6 · Zod · Recharts · pdfkit · exceljs |
| **Size** | ~80 screens, 60 database tables, 177 automated workflow tests + a large-data speed test |

→ **Start here (non-technical): [`docs/FULL_GUIDE.md`](docs/FULL_GUIDE.md)** – every section, why it exists, how to use it · role-by-role day plans: [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)
→ Technical docs: [`ARCHITECTURE`](docs/ARCHITECTURE.md) · [`DATABASE`](docs/DATABASE.md) · [`WORKFLOWS`](docs/WORKFLOWS.md) · [`ROLES & PERMISSIONS`](docs/ROLES_AND_PERMISSIONS.md)

---

## What's inside

CRM (leads, pipeline board, follow-ups, clients, site visits) · Quotations (revisions, PDF, approval) · BOQ (cost vs selling, Excel import/export, revisions, compare) · Approvals (amount-based routing) · Projects (tasks, milestones, timeline, live profit) · Procurement (requests, POs, vendors, deliveries) · Inventory (ledger-based stock, receipts, site issue/return, low-stock alerts) · Workforce (workers, contractors, work orders, attendance, wages) · HR (employees, leave, payroll, payslips, announcements) · Finance (invoices, stage billing, payments, expenses, vendor bills, receivables/payables ageing) · Documents (secure uploads, versions, expiry) · WhatsApp inbox (official Cloud API) · Customer support & warranty · Marketing · Dashboards per role · 18 exportable reports · Global search · Client / vendor / worker portals · Audit log · Daily automation.

---

## Quick start (development)

**Requirements:** Node.js 20+ and npm. *No PostgreSQL install needed for development* – an embedded real PostgreSQL is included.

```bash
cd app
npm install
cp .env.example .env            # then edit AUTH_SECRET (see below)

# terminal 1 – database (leave running)
npm run db:start

# terminal 2
npx prisma migrate deploy       # create tables
npm run db:seed                 # demo data (safe to re-run)
npm run dev                     # http://localhost:3000
```

Sign in with a demo account (password **`Demo@1234`** for all):

| Role | Email |
|---|---|
| Owner | `owner@dsc.demo` |
| Management / Director | `director@dsc.demo` |
| Admin | `admin@dsc.demo` |
| Sales | `sales@dsc.demo`, `sales2@dsc.demo` |
| Project Manager | `pm@dsc.demo`, `pm2@dsc.demo` |
| Designer | `designer@dsc.demo` |
| Procurement | `procurement@dsc.demo` |
| Accounts | `accounts@dsc.demo` |
| HR | `hr@dsc.demo` |
| Store keeper | `store@dsc.demo` |
| Site engineer / Supervisor | `engineer@dsc.demo`, `supervisor@dsc.demo` |
| Worker (phone screen) | `w-00001@workers.local` |
| Client (portal) | `client@dsc.demo`, `bhatia@dsc.demo` |
| Vendor (portal) | `vendor@dsc.demo` |

> **Change or delete the demo users before real use** (Settings → Team & Users).

### Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. Dev default points at the embedded DB on port 5434. |
| `AUTH_SECRET` | yes | Random string ≥ 32 chars. Signs login sessions **and** derives the key that encrypts stored integration secrets. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Changing it signs everyone out and invalidates stored WhatsApp tokens. |
| `APP_URL` | yes (prod) | Public URL, e.g. `https://erp.dscinterior.com`. Shown as the WhatsApp webhook address. |
| `UPLOAD_DIR` | no | Folder for uploaded files (default `./uploads`). Must be persistent and backed up. |
| `CRON_SECRET` | no | ≥ 16 chars. Enables `POST /api/cron/daily` for a fixed-time scheduler. |

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run db:start` | Embedded dev PostgreSQL |
| `npx prisma migrate deploy` | Apply migrations (dev & production) |
| `npm run db:seed` | Load demo data |
| `npm test` | 177 automated tests (needs `db:start`; uses its own throw-away database) |
| `npm run perf` | Speed test: loads 10k leads, 10k tasks, 100k stock movements, 100k attendance rows into a throw-away database and times every heavy screen (all must be < 1.5 s) |
| `npx tsx scripts/smoke.ts` | Page / permission / PDF smoke test against a running server |
| `npm run typecheck` · `npm run lint` | Static checks |
| `npm run docs` | Regenerate `docs/DATABASE.md` and `docs/ROLES_AND_PERMISSIONS.md` |

### Changing the database structure

`prisma migrate dev` needs an interactive terminal. In scripts/CI create the SQL with
`npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script`,
save it as `prisma/migrations/<timestamp>_<name>/migration.sql`, then run `npx prisma migrate deploy`.

---

## Production deployment

1. **PostgreSQL 14+** (managed service recommended – RDS, Supabase, Neon, DigitalOcean…). Create a database and a user; set `DATABASE_URL`. Enable automated daily backups.
2. **Server:** any Node 20+ host (a 2 GB VM is plenty) or a container.
   ```bash
   npm ci
   npx prisma migrate deploy
   npm run build
   npm start            # listens on :3000
   ```
3. **HTTPS + reverse proxy** (Nginx, Caddy or the platform's router) in front of port 3000. Set `X-Forwarded-For`. Required for WhatsApp webhooks and secure cookies.
4. **Environment:** set `NODE_ENV=production`, `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `UPLOAD_DIR` (a persistent disk), optionally `CRON_SECRET`.
5. **First run:** create the company and owner. `npm run db:seed` creates a demo company – for a real install, instead run a one-off script or insert your `Company`, `CompanySettings` and an `OWNER` `User` (password hash from `bcryptjs`), then sign in and use Settings → Team & Users.
6. **Scheduler (optional but recommended):** call once a day, e.g. 07:00 IST
   `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://erp.example.com/api/cron/daily`
   Without it the same rules run automatically the first time anyone opens the dashboard each day.
7. **Backups:** the database *and* `UPLOAD_DIR`.
8. **Updating:** `git pull && npm ci && npx prisma migrate deploy && npm run build`, then restart.

Scaling note: the login rate-limiter is in-memory (per process). Running several instances? Put the limiter in Redis or at the proxy.

---

## Integrations

| Integration | Status |
|---|---|
| **WhatsApp Business Cloud API** (official) | Fully built: inbox, templates, webhook (HMAC-verified), delivery status, automatic messages. **Needs your Meta credentials** – Settings → WhatsApp Connection. Until then messages are stored as "not delivered". |
| **Email** | In-app notifications work. Email delivery is not wired – add a sender inside `src/lib/notify.ts` (single choke-point for all notifications). |
| **File storage** | Local disk behind `src/lib/storage.ts`. To use S3, implement `putFile/getFile/deleteFile` against the S3 SDK there; nothing else changes. |
| **Instagram / Facebook** | Marketing tracks campaigns and lead-source results manually. No scraping and no unofficial APIs; official Graph API ingestion can be added later. |
| **Payments / accounting software** | Not integrated. Exports (CSV/Excel/PDF) are available for the accountant. |

---

## Project structure

```
app/
├─ prisma/                 schema.prisma, migrations/, seed.ts + seed/*.ts (demo data)
├─ scripts/                dev-db.ts (embedded Postgres), smoke.ts, gen-docs.ts
├─ tests/                  vitest suites (call the real server actions against a real test DB)
├─ docs/                   ARCHITECTURE, DATABASE, WORKFLOWS, ROLES_AND_PERMISSIONS, USER_GUIDE
└─ src/
   ├─ app/
   │  ├─ (app)/            staff application (CRM, sales, projects, procurement, inventory, workforce, HR, finance, …)
   │  ├─ (portal)/         client & vendor portals
   │  ├─ (worker)/         worker mobile app
   │  ├─ api/              WhatsApp webhook, daily-cron hook
   │  └─ login/
   ├─ components/          ui/ (design system), forms/, list/, layout/, documents/
   └─ lib/                 permissions, auth, scope, audit, approvals, inventory, money, payroll,
                           project-finance, finance-stats, reports, automation, whatsapp, pdf, storage…
```

---

## Security summary

- Sessions: signed, httpOnly, SameSite=Lax cookie (12 h); the user is re-checked in the database on **every** request, so deactivating someone takes effect immediately. Passwords hashed with bcrypt (cost 11). Login is rate-limited and gives the same message for unknown user / wrong password.
- Authorization: role permissions **plus** row-level scoping, enforced server-side on pages, downloads and every server action. Portal users have separate, scope-locked actions.
- CSRF: server actions are same-origin only (Next.js origin check) and cookies are SameSite=Lax.
- Injection / XSS: all database access goes through Prisma (parameterised); React escapes output; uploads are allow-listed by extension **and** magic bytes, served with `nosniff` and a sandboxing CSP, from a non-public folder, behind an access check.
- Integration secrets (WhatsApp token/app secret) are encrypted at rest (AES-256-GCM). Webhooks require a valid HMAC signature.
- Everything important is written to an append-only audit log (who, what, old → new value, IP, device).
- Security headers: `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, restricted permissions policy.

## Known limitations

- **GST:** one GST % per line; the CGST/SGST vs IGST split and GST returns are not produced. Share the Excel exports with your CA.
- **Accounting:** operational finance (invoices, payments, bills, expenses, ageing, cash-flow, project profit) – not a full double-entry ledger, no bank reconciliation.
- **Payroll:** attendance/leave-driven with configurable PF % and a fixed deduction. TDS/ESI/PT slabs are not built in (by design – statutory rules must be configured, not hard-coded).
- **Permissions** are defined in code (`src/lib/permissions.ts`); there is no screen to edit the matrix. (Approval limits *are* editable in Settings.)
- **WhatsApp:** free text works inside WhatsApp's 24-hour window; starting conversations later needs Meta-approved templates (wording supplied in `src/lib/whatsapp.ts`).
- Email delivery, S3 storage and Redis rate limiting are extension points, not built.
- English UI, INR only. The Gantt view is a read-only timeline.
- Imports (CSV/Excel) are available for clients, leads, vendors, materials, workers, employees and BOQ items; other data is entered in the screens.
