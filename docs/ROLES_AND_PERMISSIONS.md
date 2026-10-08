# Roles & permissions

> Generated from `src/lib/permissions.ts` by `npm run docs` – do not edit by hand.

Access is decided in **two layers**:

1. **Permission** (this page) – *what* a role may do in a module: view, create, edit, delete, approve, export, manage.
2. **Data scope** – *which records* the role may see. Examples: a Sales user sees only leads assigned to them; a Project Manager sees only projects they work on; a Client sees only their own project, quotations and invoices; a Vendor sees only their own purchase orders; a Worker sees only their own tasks. Scoping is enforced inside every query (`src/lib/scope.ts`), not just in the menu.

Sensitive information has its own switches: **margins:view** (costs, margins, profit), **salary:view**, **finance:view**, **audit:view**, **users:manage**.

Menus are hidden for modules a role cannot open, and the server re-checks on every page, download and action – hiding a menu is never the only protection.

## Summary

| Role | Modules | Cost & margin | Salaries | Finance overview | Audit log | Manage users |
|---|---|---|---|---|---|---|
| Owner / Super Admin | 32 | ✔ | ✔ | ✔ | ✔ | ✔ |
| Management / Director | 32 | ✔ | ✔ | ✔ | ✔ | – |
| Admin | 32 | – | – | – | ✔ | ✔ |
| Sales | 15 | – | – | – | – | – |
| Project Manager | 23 | ✔ | – | – | – | – |
| Designer | 11 | – | – | – | – | – |
| Procurement | 15 | – | – | – | – | – |
| Accounts / Finance | 19 | ✔ | – | ✔ | – | – |
| HR | 12 | – | ✔ | – | – | – |
| Store / Inventory | 9 | – | – | – | – | – |
| Site Engineer | 15 | – | – | – | – | – |
| Site Supervisor | 11 | – | – | – | – | – |
| Worker | 3 | – | – | – | – | – |
| Vendor | 3 | – | – | – | – | – |
| Client | 7 | – | – | – | – | – |

## Full matrix

Columns: **V**iew · **C**reate · **E**dit · **D**elete · **A**pprove · e**X**port · **M**anage.

### Owner / Super Admin

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| leads | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| clients | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| sitevisits | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| quotations | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| boq | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| projects | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| tasks | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| purchase requests | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| purchase orders | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| vendors | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| materials | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| inventory | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| workers | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| contractors | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| attendance | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| employees | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| leaves | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| payroll | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| invoices | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| payments | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| expenses | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| vendor bills | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| approvals | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| documents | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| whatsapp | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| support | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| marketing | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| reports | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| settings | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| team | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| notifications | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

Special access: margins:view, salary:view, finance:view, audit:view, users:manage

### Management / Director

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| leads | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| clients | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| sitevisits | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| quotations | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| boq | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| projects | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| tasks | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| purchase requests | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| purchase orders | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| vendors | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| materials | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| inventory | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| workers | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| contractors | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| attendance | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| employees | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| leaves | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| payroll | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| invoices | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| payments | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| expenses | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| vendor bills | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| approvals | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| documents | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| whatsapp | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| support | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| marketing | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| reports | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| settings | ✔ |  |  |  |  |  |  |
| team | ✔ |  |  |  |  |  |  |
| notifications | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

Special access: margins:view, salary:view, finance:view, audit:view

### Admin

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| leads | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| clients | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| sitevisits | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| quotations | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| boq | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| projects | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| tasks | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| purchase requests | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| purchase orders | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| vendors | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| materials | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| inventory | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| workers | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| contractors | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| attendance | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| employees | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| leaves | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| payroll | ✔ |  |  |  |  |  |  |
| invoices | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| payments | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| expenses | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| vendor bills | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| approvals | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| documents | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| whatsapp | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| support | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| marketing | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| reports | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| settings | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| team | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| notifications | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

Special access: audit:view, users:manage

### Sales

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| leads | ✔ | ✔ | ✔ |  | ✔ | ✔ | ✔ |
| clients | ✔ | ✔ | ✔ |  |  | ✔ |  |
| sitevisits | ✔ | ✔ | ✔ |  |  |  |  |
| quotations | ✔ | ✔ | ✔ |  |  | ✔ |  |
| boq | ✔ |  |  |  |  |  |  |
| projects | ✔ |  |  |  |  |  |  |
| leaves | ✔ | ✔ |  |  |  |  |  |
| approvals | ✔ |  |  |  |  |  |  |
| documents | ✔ | ✔ | ✔ |  |  |  |  |
| whatsapp | ✔ | ✔ | ✔ |  |  |  |  |
| support | ✔ |  |  |  |  |  |  |
| marketing | ✔ |  |  |  |  |  |  |
| reports | ✔ |  |  |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

### Project Manager

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| clients | ✔ |  |  |  |  |  |  |
| sitevisits | ✔ | ✔ | ✔ |  |  |  |  |
| quotations | ✔ |  |  |  |  |  |  |
| boq | ✔ | ✔ | ✔ |  |  | ✔ |  |
| projects | ✔ |  | ✔ |  |  | ✔ |  |
| tasks | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| purchase requests | ✔ | ✔ | ✔ |  |  |  |  |
| purchase orders | ✔ |  |  |  |  |  |  |
| vendors | ✔ |  |  |  |  |  |  |
| materials | ✔ |  |  |  |  |  |  |
| inventory | ✔ |  |  |  |  |  |  |
| workers | ✔ |  |  |  |  |  |  |
| contractors | ✔ |  |  |  |  |  |  |
| attendance | ✔ | ✔ | ✔ |  |  |  |  |
| leaves | ✔ | ✔ |  |  |  |  |  |
| expenses | ✔ | ✔ | ✔ |  |  |  |  |
| approvals | ✔ |  |  |  | ✔ |  |  |
| documents | ✔ | ✔ | ✔ |  |  |  |  |
| whatsapp | ✔ |  |  |  |  |  |  |
| support | ✔ | ✔ | ✔ |  |  |  |  |
| reports | ✔ |  |  |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: margins:view

### Designer

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| clients | ✔ |  |  |  |  |  |  |
| sitevisits | ✔ | ✔ | ✔ |  |  |  |  |
| quotations | ✔ | ✔ | ✔ |  |  |  |  |
| boq | ✔ | ✔ | ✔ |  |  |  |  |
| projects | ✔ |  |  |  |  |  |  |
| tasks | ✔ | ✔ | ✔ |  |  |  |  |
| leaves | ✔ | ✔ |  |  |  |  |  |
| approvals | ✔ |  |  |  |  |  |  |
| documents | ✔ | ✔ | ✔ |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

### Procurement

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| boq | ✔ |  |  |  |  |  |  |
| projects | ✔ |  |  |  |  |  |  |
| purchase requests | ✔ | ✔ | ✔ |  | ✔ | ✔ | ✔ |
| purchase orders | ✔ | ✔ | ✔ |  | ✔ | ✔ | ✔ |
| vendors | ✔ | ✔ | ✔ |  |  | ✔ |  |
| materials | ✔ | ✔ | ✔ |  |  | ✔ |  |
| inventory | ✔ | ✔ |  |  |  | ✔ |  |
| leaves | ✔ | ✔ |  |  |  |  |  |
| vendor bills | ✔ | ✔ | ✔ |  |  |  |  |
| approvals | ✔ |  |  |  |  |  |  |
| documents | ✔ | ✔ | ✔ |  |  |  |  |
| whatsapp | ✔ |  |  |  |  |  |  |
| reports | ✔ |  |  |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

### Accounts / Finance

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| clients | ✔ |  |  |  |  |  |  |
| quotations | ✔ |  |  |  |  |  |  |
| boq | ✔ |  |  |  |  |  |  |
| projects | ✔ |  |  |  |  |  |  |
| purchase orders | ✔ |  |  |  |  |  |  |
| vendors | ✔ |  |  |  |  |  |  |
| workers | ✔ |  |  |  |  |  |  |
| attendance | ✔ |  |  |  |  |  |  |
| leaves | ✔ | ✔ |  |  |  |  |  |
| payroll | ✔ |  |  |  |  |  |  |
| invoices | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| payments | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| expenses | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| vendor bills | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| approvals | ✔ |  |  |  | ✔ |  |  |
| documents | ✔ | ✔ | ✔ |  |  |  |  |
| reports | ✔ |  |  |  |  | ✔ |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: margins:view, finance:view

### HR

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| workers | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| contractors | ✔ | ✔ | ✔ |  |  |  |  |
| attendance | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| employees | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| leaves | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| payroll | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| approvals | ✔ |  |  |  | ✔ |  |  |
| documents | ✔ | ✔ | ✔ |  |  |  |  |
| reports | ✔ |  |  |  |  | ✔ |  |
| team | ✔ |  |  |  |  |  | ✔ |
| notifications | ✔ |  |  |  |  |  |  |

Special access: salary:view

### Store / Inventory

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| projects | ✔ |  |  |  |  |  |  |
| purchase orders | ✔ |  |  |  |  |  |  |
| materials | ✔ | ✔ | ✔ |  |  | ✔ |  |
| inventory | ✔ | ✔ | ✔ |  | ✔ | ✔ | ✔ |
| leaves | ✔ | ✔ |  |  |  |  |  |
| documents | ✔ |  |  |  |  |  |  |
| reports | ✔ |  |  |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

### Site Engineer

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| sitevisits | ✔ | ✔ | ✔ |  |  |  |  |
| boq | ✔ |  |  |  |  |  |  |
| projects | ✔ |  |  |  |  |  |  |
| tasks | ✔ | ✔ | ✔ |  |  |  |  |
| purchase requests | ✔ | ✔ | ✔ |  |  |  |  |
| materials | ✔ |  |  |  |  |  |  |
| inventory | ✔ | ✔ |  |  |  |  |  |
| workers | ✔ |  |  |  |  |  |  |
| attendance | ✔ | ✔ | ✔ |  |  |  |  |
| leaves | ✔ | ✔ |  |  |  |  |  |
| expenses | ✔ | ✔ |  |  |  |  |  |
| documents | ✔ | ✔ | ✔ |  |  |  |  |
| support | ✔ | ✔ | ✔ |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

### Site Supervisor

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| dashboard | ✔ |  |  |  |  |  |  |
| projects | ✔ |  |  |  |  |  |  |
| tasks | ✔ | ✔ | ✔ |  |  |  |  |
| purchase requests | ✔ | ✔ | ✔ |  |  |  |  |
| inventory | ✔ | ✔ |  |  |  |  |  |
| workers | ✔ |  |  |  |  |  |  |
| attendance | ✔ | ✔ | ✔ |  |  |  |  |
| leaves | ✔ | ✔ |  |  |  |  |  |
| expenses | ✔ | ✔ |  |  |  |  |  |
| documents | ✔ | ✔ | ✔ |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

### Worker

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| tasks | ✔ |  | ✔ |  |  |  |  |
| attendance | ✔ | ✔ |  |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

### Vendor

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| purchase orders | ✔ |  |  |  |  |  |  |
| documents | ✔ |  |  |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

### Client

| Module | V | C | E | D | A | X | M |
|---|---|---|---|---|---|---|---|
| quotations | ✔ |  |  |  |  |  |  |
| projects | ✔ |  |  |  |  |  |  |
| invoices | ✔ |  |  |  |  |  |  |
| payments | ✔ |  |  |  |  |  |  |
| documents | ✔ |  |  |  |  |  |  |
| support | ✔ |  |  |  |  |  |  |
| notifications | ✔ |  |  |  |  |  |  |

Special access: none

## Approval authority

Who can approve what, by amount (limits are configurable in Settings → Company):

| Type | ≤ Level 1 (default ₹25,000) | ≤ Level 2 (default ₹1,00,000) | Above |
|---|---|---|---|
| Purchase request, purchase order, expense, vendor payment | Project Manager* | Management | Owner |
| Quotation, BOQ, invoice, discount, budget | Management | Management | Management |
| Leave | HR | HR | HR |

*A Project Manager can approve only for projects they manage. A person never approves their own request (except the Owner). Management and the Owner can approve anything the level below them can. If the requester already has enough authority the request is auto-approved – and still audited.

## Role labels

- `OWNER` – Owner / Super Admin
- `MANAGEMENT` – Management / Director
- `ADMIN` – Admin
- `SALES` – Sales
- `PROJECT_MANAGER` – Project Manager
- `DESIGNER` – Designer
- `PROCUREMENT` – Procurement
- `ACCOUNTS` – Accounts / Finance
- `HR` – HR
- `STORE` – Store / Inventory
- `SITE_ENGINEER` – Site Engineer
- `SITE_SUPERVISOR` – Site Supervisor
- `WORKER` – Worker
- `VENDOR` – Vendor
- `CLIENT` – Client
