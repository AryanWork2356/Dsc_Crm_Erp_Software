# DSC Interior ERP – The Complete Guide

*Every section of the software: where it is, who uses it, how to use it, why it exists, and why it is easier than before.*

> **How to read this guide.** Each section follows the same pattern:
> **📍 Where** (menu path) · **👤 Who** · **🎯 Why it exists** · **🛠 How to use it** · **✅ Simpler because…**
>
> The "Before" lines describe the *typical* way an interior firm works with WhatsApp, Excel, Drive and separate accounting/HR tools. Replace them with DSC's real habits if they differ – the point is the comparison.

---

## Part 1 – The big picture

### The problem it solves
A single interior project touches about ten people and ten tools: the salesperson's WhatsApp, an Excel quotation, a BOQ in another Excel, purchase orders in Word, vendor chats, a stock register, attendance in a notebook, wages in cash, invoices in the accountant's software, drawings in Google Drive. **Nothing is connected**, so:

- the same number is typed 3–4 times (and ends up different in each place),
- nobody knows the real profit of a job until it is over,
- approvals happen on WhatsApp and get forgotten,
- material goes missing between "ordered" and "used",
- owners ask "where are we on that project?" and someone has to call around.

### The idea
**One system, one database, everybody's work connected.** Enter a thing once; every place that needs it already has it.

```
Enquiry → Site visit → Quotation → Approval → Client says yes → Project + BOQ
   → Purchase request → Purchase order → Delivery → Stock → Issued to site
   → Workers' attendance → Tasks & milestones → Invoices → Payments
   → Live profit  ·  Warranty & support after handover
```

### How it is built (in one paragraph)
It is a **web application** – you open it in Chrome/Edge/Safari on a laptop or phone, like a website. Behind it sits a proper **PostgreSQL database** (the same kind of database banks and large companies use) that stores everything safely. The screens are built with Next.js/React; money, stock and approvals are protected by automated tests (175+ of them) so calculations stay right. Details: [`ARCHITECTURE.md`](ARCHITECTURE.md).

### Why a web app and not a phone app
Staff use laptops in the office and phones on site. One web address works everywhere, updates instantly for everyone (nothing to install or update), and the simple worker screen works on any basic smartphone.

---

## Part 2 – Getting started

### Signing in
Open the address your admin gives you → email + password. Everyone has their own login; every action is recorded under their name.

| Role | Demo login | Lands on |
|---|---|---|
| Owner | `owner@dsc.demo` | Owner dashboard |
| Director | `director@dsc.demo` | Owner dashboard |
| Admin | `admin@dsc.demo` | Owner dashboard |
| Sales | `sales@dsc.demo` | Sales dashboard |
| Project Manager | `pm@dsc.demo` | PM dashboard |
| Designer | `designer@dsc.demo` | Work dashboard |
| Procurement | `procurement@dsc.demo` | Procurement dashboard |
| Accounts | `accounts@dsc.demo` | Accounts dashboard |
| HR | `hr@dsc.demo` | HR dashboard |
| Store keeper | `store@dsc.demo` | Store dashboard |
| Site engineer / supervisor | `engineer@dsc.demo`, `supervisor@dsc.demo` | Work dashboard |
| Worker | `w-00001@workers.local` | Phone worker app |
| Client / Vendor | `client@dsc.demo`, `vendor@dsc.demo` | Portals |

All demo passwords: `Demo@1234`. **Delete or change demo users before real use** (Admin → Team & Users).

### The screen layout (same everywhere)
| Part | What it does |
|---|---|
| **Left menu** | Your sections. You only see what your job needs. On a phone: ☰ button. |
| **Search box (top)** | Find anything by name, phone or ID – clients, leads, projects, POs, invoices, vendors, documents. |
| **🔔 Bell (top right)** | Your personal alerts. Click to jump to the thing. |
| **Coloured tags** | Draft · Pending approval · Approved · Paid · Overdue… same colours everywhere. |
| **Filter bar above tables** | Search + filters + sort + pages. Click **Export** where offered. |

✅ **Simpler because** there is *one* place to look, one search for everything, and one bell instead of 20 WhatsApp groups.

---

## Part 3 – Every section, one by one

---

### 1. Dashboard
**📍 Where:** first item in the menu (also your home page after login)
**👤 Who:** everyone – each role sees a *different* dashboard.
**🎯 Why:** so each person immediately sees *"What do I need to do today?"* without opening 15 screens.

| Role | What the dashboard shows |
|---|---|
| **Owner / Director / Admin** | Alerts ("3 quotations awaiting approval", "2 projects delayed", "₹4.8 L overdue", "5 materials low", "PRJ-002 is 12% over budget"), active/delayed/completed projects, leads & conversion, quotation value, receivable/payable, inventory value, workers present today, 6-month cash-in vs cash-out chart, sales funnel, lead sources, project status, spending by vendor/material, project profitability table. A **period selector**: Today / Week / Month / Quarter / Year / Custom dates. |
| **Sales** | Follow-ups due, open pipeline value, quotations out with clients, my quotations by status. |
| **Project Manager** | My projects with progress, my tasks, workers on site today, approvals waiting, support tickets for me. |
| **Procurement** | Approved requests waiting to be ordered, deliveries to chase (late ones in red), materials running low. |
| **Store keeper** | Low-stock list. |
| **Accounts** | Invoices to collect, vendor bills to pay, open receivables. |
| **HR** | Pending leave requests, workers on site. |

**🛠 How to use:** open it each morning; click any red alert or card to jump straight to the item.
✅ **Simpler because** — *Before:* the owner phoned the PM, the accountant, the store, then added it up. *Now:* one screen, live, no phone calls. It also **runs the daily reminders** automatically the first time anyone opens it each day.

---

### 2. CRM – Leads
**📍 Where:** CRM → Leads
**👤 Who:** Sales (own leads), Management (all).
**🎯 Why:** every enquiry becomes a tracked record so none is forgotten and you can see which sources actually bring work.

**🛠 How to use**
1. **Add lead** – name, phone, source (Instagram, referral…), segment, estimated value, requirement. (If Management adds it without an owner, it is auto-given to the salesperson with the fewest open leads.)
2. Open the lead → **Log call / note** every time you speak. A call on a "New" lead moves it to "Contacted".
3. **Schedule follow-up** (date + what to discuss). When done, **Mark done** and set the next one.
4. Switch **List ↔ Pipeline** (top right). In Pipeline, **drag a card** to the next stage (New → Contacted → Qualified → Site visit → Proposal → Quotation sent → Negotiation → Won / Lost). Moving to **Lost** asks for a reason.
5. **Convert to client** when serious – all details carry forward.
6. Filters: stage, segment, source, priority, owner, "overdue follow-ups". **Export CSV** available.

✅ **Simpler because** — *Before:* leads in WhatsApp chats and a sheet; follow-ups lived in memory. *Now:* the Follow-ups page lists exactly who to call today, the whole history of each lead is on its page, and a manager can see the pipeline value at a glance.

---

### 3. CRM – Clients
**📍 Where:** CRM → Clients
**👤 Who:** Sales, Management, PM (view), Accounts (view).
**🎯 Why:** one profile per customer – contact, GSTIN/PAN, billing address – linking all their leads, projects, quotations, invoices, tickets and files. One client can have many projects.

**🛠 How:** Add client (or convert from a lead). Open a client to see projects, quotations, outstanding balance (finance roles only) and upload their documents.
✅ **Simpler because** — *Before:* details copied into every quotation/invoice by hand. *Now:* pick the client from a list; GSTIN and address flow into the PDF automatically.

---

### 4. CRM – Site Visits
**📍 Where:** CRM → Site Visits (also from a lead page → *Schedule*)
**👤 Who:** Sales, Designer, PM, Site engineer.
**🎯 Why:** record what was seen and measured on site so quotations are based on facts.

**🛠 How:** Schedule (date, time, assignee, address). After the visit open it → **Record**: site condition, measurements, requirements, estimated area, follow-up date → **Mark done**. Scheduling moves the lead to "Site visit scheduled"; completing moves it forward and sets the next follow-up. The assigned person gets a notification.
✅ **Simpler because** — measurements are no longer in a notebook or a WhatsApp photo; they sit on the lead/client forever.

---

### 5. CRM – Follow-ups
**📍 Where:** CRM → Follow-ups
**🎯 Why:** a worklist: **Overdue**, **Today**, **Next 7 days**.
**🛠 How:** tap **Call**, then **Done** (note the outcome and next date) or **Reschedule**.
✅ **Simpler because** — the morning question "who should I call?" is answered in one screen. The system also sends each salesperson a daily reminder.

---

### 6. Sales – Quotations
**📍 Where:** Sales → Quotations
**👤 Who:** Sales, Designer (create); Management approves; PM/Accounts view.
**🎯 Why:** professional, correct, approved quotations – with every revision remembered.

**🛠 How to use**
1. **New quotation** → pick client (and lead) → add **line items** (category, description, unit, qty, rate, GST%) → discount % → load a **terms template** → Save. **Totals and GST are calculated for you** (and re-checked on the server – the browser cannot cheat).
2. **Submit for approval** → Management sees it in *Approvals* → approves/rejects (reason needed to reject).
3. **Mark as sent** → download **PDF** (company header, GSTIN, items grouped by category, amount in words, terms, bank details).
4. Track: **Client viewed → In negotiation → Client accepted / rejected**. Unsent past-validity quotations become **Expired** automatically.
5. **Revise** (never edit an approved one): the old version stays in *Revision history*, the number stays, status returns to Draft for re-approval.
6. **Accepted → Convert to project:** creates the project + a draft BOQ from the lines, assigns the PM, notifies them.
7. From a BOQ you can also **Create quotation** (selling rates only – costs never copied).

✅ **Simpler because** — *Before:* Excel file copies ("final_v3_new2.xlsx"), GST worked out by calculator, approval by WhatsApp, re-typing everything into a project. *Now:* one record, auto-totals, formal approval trail, one click to the project.

---

### 7. Sales – Bill of Quantities (BOQ)
**📍 Where:** Sales → Bill of Quantities
**👤 Who:** PM, Designer (edit); Management approves; **only roles with cost access see costs**.
**🎯 Why:** the heart of cost control – what we will build, what it costs us, what we charge, and the margin.

**🛠 How to use**
1. **New BOQ** (or one is created when a quotation becomes a project).
2. Add rows: category, item, specification, unit, quantity, **material / labour / other cost per unit**, **selling rate**. Each row shows estimated cost, total and margin %; the top shows **Estimated cost · Selling total · Gross margin · Margin %**; a table shows totals by category.
3. **Import from Excel** (download the template) or **Export** to Excel / client-safe PDF.
4. **Submit for approval** → approved BOQs are **locked**. **Revise** makes `BOQ-00012-R2` and marks the old one Revised. **Compare** shows exactly what changed between versions and the effect on cost and margin.
5. On the project: **Set budget from BOQ**.
6. Link items to catalogue **materials** to track purchases and usage against the plan.

✅ **Simpler because** — *Before:* cost sheet and client sheet were separate Excels that drifted apart; nobody knew the margin until the end. *Now:* cost and price live side by side; staff who shouldn't see costs literally can't (and can't alter them either).

---

### 8. Approvals
**📍 Where:** Approvals (menu) – also the 🔔 bell
**👤 Who:** Project Managers, Management, Owner, HR (leave).
**🎯 Why:** one inbox for every decision, with rules instead of WhatsApp.

**🛠 How:** tabs **Waiting for me / My requests / History**. **Approve** with one click, or **Reject** with a reason. The requester is notified.

**Who approves what (limits editable in Settings → Company):**
| | up to ₹25,000 | up to ₹1,00,000 | above |
|---|---|---|---|
| Purchase request, PO, expense, vendor payment | Project Manager (own projects) | Management | Owner |
| Quotation, BOQ, invoice | Management | Management | Management |
| Leave | HR | HR | HR |

Nobody approves their own request (except the Owner). If you already have enough authority, your own request is auto-approved (still recorded).
✅ **Simpler because** — *Before:* "bhai approve karo" on WhatsApp, lost in a chat. *Now:* nothing proceeds without it, nothing is forgotten, and the audit log shows who approved what and when.

---

### 9. Projects
**📍 Where:** Projects → All Projects
**👤 Who:** PM, Site engineer, Designer (their projects); Management, Accounts (all).
**🎯 Why:** the single home of a job.

**🛠 How:** open a project; tabs:
- **Overview** – progress %, planned vs actual dates, team, upcoming milestones & tasks, delay warnings.
- **Tasks** – add tasks (assignee, dates, priority, **"depends on"**), quick status & progress, comments. Progress of the project = average of tasks. A task can't start before the one it depends on finishes.
- **Timeline** – a Gantt-style bar chart with a "today" line.
- **Milestones** – stages with a **billing %** (e.g. 30/30/30/10); mark done → Accounts is alerted; **the client can approve the stage** in their portal.
- **BOQ** – the project's BOQs.
- **Materials** – *plan vs purchased vs received vs issued vs consumed vs on-site vs still-to-buy*; flags over-use.
- **Documents** – drawings, contracts, photos.
- **Profit & budget** *(cost-access roles only)* – contract value, budget, actual cost split into Material / Labour / Vendors / Other, **variance**, **profit and margin %**, billed / collected / outstanding. **Live** – changes the moment a bill, issue or wage is recorded.

Status moves Planning → Design → … → Handover → Completed (can't complete with open tasks).
✅ **Simpler because** — *Before:* the true profit appeared after the job when the accountant added everything up. *Now:* you can see on day 20 that the job is 12% over budget and fix it.

---

### 10. Projects – Tasks
**📍 Where:** Projects → Tasks
**🎯 Why:** my work across all projects: **My tasks** / **All tasks**, filter overdue, change status and progress inline.
✅ Replaces the "what did I promise this week?" notes.

---

### 11. Procurement – Purchase Requests
**📍 Where:** Procurement → Purchase Requests
**👤 Who:** Site engineers, supervisors, PMs (raise); Procurement (act).
**🎯 Why:** site asks in a structured way; approval before money is spent.

**🛠 How:** **New request** (optionally *prefill from the project's BOQ*) → project, needed-by date, priority, reason, items (pick from the material catalogue) → Save → **Submit for approval**. When approved, Procurement clicks **Create purchase order**.
✅ **Simpler because** — *Before:* phone calls and chat messages "plywood chahiye". *Now:* a record with quantities, dates, approvals; Procurement sees exactly what's approved and waiting.

---

### 12. Procurement – Purchase Orders
**📍 Where:** Procurement → Purchase Orders
**👤 Who:** Procurement; approvals per amount.
**🎯 Why:** formal orders with price, tax, delivery date, charged to a project.

**🛠 How:** **New PO** (or from an approved request) → vendor, project, delivery date, payment terms, items (rates auto-fill from last purchase), discount, terms → Save → **Submit for approval** → **Mark sent to vendor** (download the **PDF**). Statuses: Draft → Pending approval → Approved → Sent → Partially received → Received → Closed (or Cancelled). Approved POs are locked.
✅ **Simpler because** — totals/GST are automatic, the vendor gets a clean PDF, and you always know "what did we order, from whom, for which site, and has it come?"

---

### 13. Procurement – Vendors
**📍 Where:** Procurement → Vendors
**🎯 Why:** supplier profiles with GSTIN, categories, ratings and **performance**: orders placed, **on-time delivery %**, total purchased, payable now, bills and POs.
**🛠 How:** Add vendor (duplicate GSTIN is refused). Vendors can also log into their own **portal** (see Part 4).
✅ **Simpler because** — you can decide whom to order from using facts (late 4 of 5 times) instead of memory.

---

### 14. Procurement – Deliveries
**📍 Where:** Procurement → Deliveries
**🎯 Why:** what we're waiting for. **Overdue** orders in red, **Expected**, **Recently received**; a **Receive** button on each.
✅ Replaces chasing vendors from memory; Procurement also gets an automatic alert when a delivery date passes.

---

### 15. Inventory – Stock
**📍 Where:** Inventory → Stock
**👤 Who:** Store keeper, Procurement (view), PM/engineers (view).
**🎯 Why:** what we have and where – **Warehouse stock** and **Site stock** tabs, reorder levels, stock value, low-stock badges.
**🛠 How:** filter by category/location/low stock. **Record movement** for transfers, site consumption, damage and corrections (corrections and damage **require a reason**).
✅ **Simpler because** — *Before:* a stock register and guesses. *Now:* every unit has a history; **stock cannot go below zero**, even if two people issue at the same second.

---

### 16. Inventory – Materials
**📍 Where:** Inventory → Materials
**🎯 Why:** the catalogue used by BOQs, requests and POs – name, SKU, category, unit, last purchase cost, **min stock**, **reorder level**, usual vendor. Click a material to see stock by location and its full movement history.
**🛠 How:** Add one by one, or **Import from Excel**.

---

### 17. Inventory – Material Receipts
**📍 Where:** Inventory → Material Receipts (or *Receive material* on a PO / Deliveries)
**🎯 Why:** check goods in against the PO.
**🛠 How:** choose the PO → where it was delivered → for each item enter **received / damaged / rejected** (+ challan, vehicle). **Only good (accepted) quantity enters stock**; you cannot accept more than is pending. PO becomes *Partially received / Received*; the PM and Procurement are notified.
✅ **Simpler because** — *Before:* "maal aa gaya" on the phone, no proof. *Now:* a dated receipt linked to the PO, with damaged/rejected counts for vendor disputes.

---

### 18. Inventory – Issues & Returns
**📍 Where:** Inventory → Issues & Returns
**🎯 Why:** moving material from warehouse to a site and charging it to the project; bringing unused material back.
**🛠 How:** **Issue to site** → project, from-warehouse, received-by, list materials (it shows **available quantity** and stops you over-issuing). **Return from site** credits the project at the same cost.
✅ **Simpler because** — project material cost is correct **automatically**; nobody calculates it later.

---

### 19. Inventory – Stock Ledger & Locations
**📍 Where:** Inventory → Stock Ledger / Locations
**Ledger:** every movement ever (inward, outward, transfer, return, correction, damage, consumed) with who, when, where. Filter by type/project/material.
**Locations:** warehouses and each project's site store (created automatically on the first issue), with stock value.
✅ Answers "where did the 40 sheets go?" in seconds.

---

### 20. Workforce – Attendance
**📍 Where:** Workforce → Attendance
**👤 Who:** Supervisors, engineers, PMs (mark); HR (all + staff).
**🎯 Why:** daily presence per site → wages and labour cost.
**🛠 How:** pick **date** and **site** → tap **Present / Half day / Absent / Leave** for each worker (+ overtime hours) → **Save**. "Mark everyone present" saves time. Tabs: *Site workers · Who is where (all sites today) · Staff*. Workers can also **mark themselves** on their phone (with location). A worker can't be on two sites in a day; future dates are refused.
✅ **Simpler because** — *Before:* a notebook; wages calculated at month-end with arguments. *Now:* each day's **wage is calculated and frozen** at marking time (half day, overtime at 1.5×) and already counted in project cost.

---

### 21. Workforce – Workers
**📍 Where:** Workforce → Workers
**🎯 Why:** every site worker – trade, contractor, assigned site, wage, joining date, status.
**🛠 How:** Add / edit; **Create login** (gives the worker the phone app); Deactivate (workers with history can't be deleted, only deactivated). Wage visible to HR/Management only.

---

### 22. Workforce – Contractors
**📍 Where:** Workforce → Contractors
**🎯 Why:** labour contractors and sub-contractors: **work orders** (scope, rate, agreed value, project) and **payments** (Accounts records them; can't exceed the work-order value). Payments count as project cost. Shows work value, paid, balance.
✅ Replaces "how much have we given Om Sai so far?" arithmetic.

---

### 23. Workforce – Labour Cost
**📍 Where:** Workforce → Labour Cost *(cost-access roles)*
**🎯 Why:** wages by worker for a month/project – days, overtime, amount.

---

### 24. HR – Employees
**📍 Where:** HR → Employees
**🎯 Why:** staff directory with designation, department, manager, documents (Aadhaar, offer letter…), **salary structure** (HR/Management/Owner only), leave and payslips. Mark **Exited** → the person's login is switched off immediately, history kept.

### 25. HR – Leave
**📍 Where:** HR → Leave
**🛠 How:** an employee clicks **Apply for leave** (paid/unpaid, dates, reason; Sundays don't count; overlapping dates blocked) → HR gets it in Approvals. HR sees **Everyone** tab.
✅ No more leave requests on WhatsApp; payroll uses approved leave automatically.

### 26. HR – Payroll & My Payslips
**📍 Where:** HR → Payroll; every employee: HR → My Payslips
**🛠 How:** set **Payroll rules** once (working days, overtime rate, PF %, fixed deduction, absence handling) → each month **Run payroll** → review → **Adjust** incentive/bonus → download **payslip PDF**. Re-running never duplicates and keeps your adjustments. Staff see only **their own** payslips.
✅ **Simpler because** — salaries are computed from the same attendance/leave data, in minutes instead of a day of Excel.

### 27. HR – Announcements
**📍 Where:** HR → Announcements – post notices (pin important ones, set expiry); everyone is notified.

---

### 28. Finance – Overview
**📍 Where:** Finance → Overview *(finance roles)*
**🎯 Why:** receivable, overdue, payable, this month's cash in/out, 6-month chart, and the projects with the **thinnest margins**.

### 29. Finance – Invoices
**📍 Where:** Finance → Invoices
**🛠 How:** **New invoice** – from scratch, from a quotation, or **from a project milestone** (Project → Milestones → *Invoice from milestone*: % × contract value, can't bill the same stage twice). Draft → **Submit for approval** → issued (locked). **PDF** with bank details and amount in words. Status: Draft → Pending approval → Sent → Partially paid → Paid / Overdue / Cancelled.
✅ **Simpler because** — stage-wise billing is one click and always matches the contract.

### 30. Finance – Payments Received
**📍 Where:** Finance → Payments Received – **Record payment** (invoice, amount, date, method, UTR/cheque). Balance and status update instantly; you can't overpay; two people can't both record the same last rupee. Mistakes can be reversed (audited).

### 31. Finance – Receivables & Payables
**📍 Where:** Finance → Receivables / Payables
**🎯 Why:** who owes us / whom we owe, by **age** – Not due, 1–30, 31–60, 61–90, 90+ days, per client/vendor, with the oldest items listed.
✅ Collection effort goes to the right people first.

### 32. Finance – Vendor Bills
**📍 Where:** Finance → Vendor Bills – record a bill (link to the PO; duplicates refused; can't exceed the PO), then **Pay** (partial or full). Accounts can pay up to the Management limit; bigger payments need the Owner.

### 33. Finance – Expenses
**📍 Where:** Finance → Expenses – anyone with access (site staff too) logs petty cash, travel, site items, optionally against a project. **It counts toward project cost only after approval.**
✅ Small site expenses stop disappearing.

---

### 34. Documents
**📍 Where:** Documents (menu) and the **Documents** panel/tab on projects, clients, leads, vendors, employees, tickets
**🎯 Why:** all files in one controlled place.
**🛠 How:** **Upload** (PDF, images, Excel, Word, CSV, text – up to 10 MB) → type, folder, tags, **expiry date**. Uploading the same name again saves **version 2** (older versions kept). **Share** a file with the client/vendor portal (project/quotation/invoice/BOQ/PO/ticket files only). Search by name/tag/folder; filter by type or "expiring in 30 days".
**Security:** files are not public links; each download re-checks that you may see the record it belongs to; fake file types are rejected.
✅ **Simpler because** — *Before:* Drive folders with mixed access and "who has the latest drawing?" *Now:* the latest version is always on top of the project, and only the right people can open it.

### 35. WhatsApp
**📍 Where:** WhatsApp (menu); connection under Admin → WhatsApp Connection
**👤 Who:** Sales, Admin, Management.
**🎯 Why:** customer chats inside the ERP: conversations auto-linked to the lead/client, **assigned** to a person, unread counts, **ready-made templates** (lead acknowledgement, site visit confirmation, quotation sent/follow-up, payment reminder, project update, delivery update, handover, warranty update), **internal notes** (not sent), and optional **automatic messages**.
**🛠 How:** choose a chat → type & send, or **Template**. **New chat** to start one.
**Important:** it uses Meta's **official WhatsApp Business Cloud API**. Until DSC's Meta details are entered, messages are saved but marked **"Not delivered"** (so nothing silently disappears).
✅ **Simpler because** — the customer's chat history sits next to their lead, quotation and invoices, and any colleague can continue it.

### 36. Customer Support (and Warranty)
**📍 Where:** Customer Support
**🎯 Why:** after-handover complaints and warranty claims.
**🛠 How:** **New ticket** (client, project, issue, priority) – the system works out **warranty cover** (12 months from project completion) and assigns the project manager. Move it Open → Assigned → In progress → Waiting → **Resolved** (resolution text required) → Closed. Add **warranty claims**; Management approves/declines (reason needed to decline). Attach photos.
Clients can raise tickets themselves from their portal.
✅ **Simpler because** — nothing is lost after handover, and "is this free or chargeable?" is answered by the system.

### 37. Marketing
**📍 Where:** Marketing
**🎯 Why:** see which channel actually brings projects: leads, won, conversion %, open pipeline, spend and **cost per lead** per source, plus a campaign list (Instagram, Facebook, Google, exhibition…). *(Tracking is manual – no social-media scraping.)*

### 38. Reports
**📍 Where:** Reports
**🎯 Why:** formal numbers for owners, accountants and banks.
**🛠 How:** choose a report → set dates/project/client/vendor → **Run** → **Excel / CSV / PDF**.
18 reports: Sales · Lead · BOQ · Project · Profitability · Budget variance · Purchase · Vendor · Inventory · Material consumption · Worker attendance · Labour cost · Expense · Invoice · Payment · Receivables · Payables (and the Management Dashboard). You only see reports your role may run, limited to your own data.
✅ **Simpler because** — no more "export, copy, fix formulas": the report is already right.

### 39. Notifications (🔔)
**📍 Where:** bell icon / Notifications
**What triggers alerts:** follow-ups due, approvals pending, PO approved, material received, low stock, invoice due/overdue, vendor bills due, project & task deadlines, leave requests, support tickets, expiring documents, new WhatsApp message, client approvals/responses.

### 40. Global Search
Search box at the top (or `/search`): type ≥ 2 letters or an ID like `PRJ-00001`. Results are grouped by type and **limited to what you may see**.

---

### 41. Admin – Team & Users
**📍 Where:** Admin → Team & Users *(Owner/Admin)*
Add user (role, email, temporary password), edit, **Reset password**, **Deactivate** (immediate logout). Only the Owner can assign Owner/Management roles.

### 42. Admin – Company Settings
Company name, address, GSTIN, PAN, bank details, number prefixes (QT/PO/INV), default GST %, and the **approval limits**. These feed every PDF.

### 43. Admin – Roles & Permissions
A read-only view of what each role can do (also in [`ROLES_AND_PERMISSIONS.md`](ROLES_AND_PERMISSIONS.md)).

### 44. Admin – Import Data
**📍 Where:** Admin → Import Data
Bring in existing **clients, leads, vendors, materials, workers, employees** from Excel/CSV. Download the template → fill → **1 · Check file** (lists problems by row, writes nothing) → **2 · Import** (all-or-nothing). Existing records are skipped, so re-uploading is safe. BOQ items are imported inside each BOQ.
✅ Day-one setup in an afternoon instead of weeks of retyping.

### 45. Admin – Terms Templates
Reusable terms & conditions for quotations, POs, invoices; mark one as the default.

### 46. Admin – WhatsApp Connection
Enter the Meta Cloud API details (stored **encrypted**) and copy the webhook address into Meta.

### 47. Admin – Automation
Shows the daily rules and the last run; **Run now** button. Rules: expire quotations · mark overdue invoices · invoice & vendor-bill reminders · follow-ups · late deliveries · project & task deadlines · expiring documents · unowned leads. Never sends the same reminder twice.

### 48. Admin – Audit Log
Every important action – who, what, old → new value, time, IP. Nobody can edit it. Example: *"Rohan changed quotation QT-00045 from ₹8,50,000 to ₹8,20,000."*

---

## Part 4 – The three simplified experiences

### A. Worker app (phone)
Workers see **only**: today's site and supervisor (tap to call) · a huge green **MARK ATTENDANCE** button · **My tasks** with **Start / Done / Stuck** · **Need material** (becomes a request to the PM) · **Report problem** (alerts supervisor & PM) · Alerts. Large buttons, almost no text, no company information.
✅ *Before:* attendance on paper, issues by phone. *Now:* two taps.

### B. Client portal
Clients sign in to see **only their own**: project progress, stages (they can **Approve a completed stage**), site photos & shared documents, quotations (**Accept** or **Request changes**), invoices & payment history & outstanding, support requests & warranty cover. They never see costs or margins.
✅ Fewer "what's the status?" calls; approvals recorded in writing.

### C. Vendor portal
Vendors see **only their own** purchase orders, delivery status, bills and payments; they **confirm or update delivery dates** and message procurement. No project profit or other vendors.
✅ Fewer "when will you pay?" and "when will it arrive?" calls.

---

## Part 5 – Why this is simpler than before (summary)

| Before (typical) | Now |
|---|---|
| Same data typed in Excel, WhatsApp, Word, accounting software | Typed **once**; every screen reads it |
| Margin known after the job | **Live profit & budget** during the job |
| Approvals by WhatsApp | One **Approvals** inbox with amount-based rules |
| Material "gone missing" | Every unit has a **ledger**; stock can't go negative |
| Wages argued at month-end | Wage frozen **daily** from attendance |
| Quote → project re-entry | **One click** quotation → project + BOQ |
| Stage billing by calculator | **Invoice from milestone** |
| Chasing vendors/clients by phone | Portals + automatic reminders |
| Files in many folders | Versioned, access-controlled **Documents** |
| Everyone sees everything (or nothing) | Each role sees **only what it needs** |
| "Who changed this?" | **Audit log** |
| Reports built by hand | 18 reports, **Excel/PDF** in a click |

---

## Part 6 – First-week plan for DSC

| Day | Do this | Who |
|---|---|---|
| 1 | Company Settings (GST, bank, approval limits); create real users; remove demo users | Owner/Admin |
| 1–2 | **Import** clients, vendors, materials, workers, employees | Admin |
| 2 | Warehouses; reorder levels; set employee salary structures; payroll rules | Store, HR |
| 3 | Enter 1–2 live enquiries as leads; try the pipeline & follow-ups | Sales |
| 3–4 | Build a real quotation → approval → convert to project | Sales, Director, PM |
| 4–5 | Run one purchase end-to-end: request → PO → receive → issue to site | Procurement, Store |
| 5 | Mark attendance daily; give workers their phone logins | Supervisor, HR |
| Week 2 | First invoice from a milestone; record the first payment; look at Profit & budget | Accounts, PM |
| Week 2 | Connect WhatsApp (Meta details); schedule backups & the daily job | Admin / developer |

**Golden rules:** do the entry *at the time of work*; use Revise instead of editing approved documents; give a reason when asked; never share passwords.

---

## Part 7 – Where to find more
- [`USER_GUIDE.md`](USER_GUIDE.md) – role-by-role day plans and a full job walkthrough
- [`WORKFLOWS.md`](WORKFLOWS.md) – every business rule the software enforces
- [`ROLES_AND_PERMISSIONS.md`](ROLES_AND_PERMISSIONS.md) – who can do what
- [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`DATABASE.md`](DATABASE.md) – for developers
- [`../README.md`](../README.md) – installation, deployment, integrations, known limitations
