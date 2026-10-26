# DSC ERP – Short guide by role

Plain language. One page per role. Everything below exists in the app today; nothing here depends on e-mail, WhatsApp or Tally (those are **not** connected).

Sign in at https://dsccrmsoftw.vercel.app. Use the language button (top right) to read the screens in Hindi, Marathi or Gujarati.

---

## Site supervisor / site engineer (use the phone)
Your menu is short on purpose.
1. **Attendance** – mark in and out. It works only when you are within 20 metres of the site or office.
2. **Daily site report** – one in the morning, one in the evening, with photos. If it says you are not named on any project, ask your project manager to add you.
3. **Manpower** – for each trade, how many were planned and how many came. If fewer came or they were late, say why and what you did. A short crew tells the resource coordinator automatically.
4. **Tasks** – update progress, the quantity done, and release the area when it is finished and safe for the next trade. If you cannot work, mark the task **Blocked** and write the reason: the project manager gets an action.
5. **Material** – raise a material request; record what arrived (accepted / rejected); record waste or damage with a reason.
6. **Actions** – anything assigned to you with a date. Mark it done and write what you did.

## Project manager
- **Dashboard → Needs you** lists your open actions.
- **Exceptions** shows what is wrong today across your projects: no owner, no budget, no dates, no report, late milestones, moved dates, late approvals.
- **Project → Financials → Forecast final cost**: see booked cost + what is still to be delivered + your own estimate of what is still to be spent. Update the estimate when things change.
- **Launch checklist** (Project → Readiness): 11 steps from Day 0 to Day 3. Each needs a note saying who confirmed it.
- **Moving a date** needs a written reason; the first date is kept and shown as "moved +N days".
- **Extra work**: mark the kind (chargeable / included / emergency / our own rework / concession). Chargeable work needs the client's written approval before it is billed. Verify finished work so Accounts can bill it.
- **Certify vendor bills** (Bills to certify) only after checking the documents.

## Procurement
- **Deliveries**: each order line has a need-by date and the supplier's promised date. A line that will arrive late needs a reason and a recovery plan.
- **Vendors**: choose First choice / Backup / Emergency, trades and crew size. Carpenters, electricians etc. are vendors.
- **Waste / reconciliation**: issued − returned − waste − still at site = used.

## Accounts
- **Client page → Client purchase orders & account**: record each PO the client gives (number, value without GST, file). You see billed, received, left to bill and left to collect per PO, and invoices not tied to any PO on their own line.
- **New invoice**: choose the PO. Billing above the PO value is refused unless you write why; the reason is kept on the invoice. Drafts count towards the PO.
- **Follow-ups** (on each unpaid invoice): record every call or visit with what was said. While money is due you must give the **next step, its date and who does it**. A promised date never marks the invoice paid – only a recorded payment does.
- **Receivables** shows the last follow-up and any promise that was missed.
- **Vendor bills**: the app stops a repeated bill number, a bill above the PO, and – unless you write a reason – a look-alike bill (same vendor, same amount, nearly the same date) or billing for material that has not arrived. A bill cannot be paid until the project manager certifies it.

## Management / Owner
- **Exceptions** – what needs a decision today. **Key numbers** – milestones on time, plan reliability, material ready, crew who came, extra work without approval, forecast over budget, days from milestone to invoice, receivables past due. Each says how it is counted and what it is based on; with fewer than 5 records it shows a dash.
- **Feasibility check** (on a quotation) before accepting a job: 8 questions. Only Owner / Management / Admin decide: Accept / Accept with conditions / Renegotiate or decline. Accepting with open questions is recorded as an exception with a close-by date.
- **Approvals**: emergency work and concessions need a director other than the person who raised them.
- **Time Limits**: what is overdue and who it has been escalated to.

## Admin
- Add users and employees (employee codes are created automatically and never repeat), set roles, set the **resource coordinator** in company settings, and give clients portal logins.
- Roles decide what each person can see and do; the server checks this on every action, not just the menu.

---

## What is intentionally not shown
Leads / sales pipeline and the Sales role are hidden until DSC has a dedicated sales team. "Contractors" are not a separate thing: carpenters, electricians and similar are **vendors**.

## What the app does **not** do (yet)
- It does not read bills or POs automatically (no OCR): type them in and attach the file.
- It does not send e-mail or WhatsApp messages, and does not connect to Tally.
- No two-step login (2FA) yet.
- EBITDA is not shown until finance writes down what it includes.
- Vendor advances, work orders with recovery, and travel / site-transfer expense allocation are not built yet.
