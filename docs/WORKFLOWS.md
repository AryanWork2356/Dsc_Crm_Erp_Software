# Workflows

How a job moves through the system, and the rules the software enforces at each step. Every status change is written to the audit log.

```
Lead ─► Site visit ─► Quotation ─► Approval ─► Client accepts ─► Project + BOQ
                                                                     │
          ┌──────────────────────────────────────────────────────────┤
          ▼                          ▼                               ▼
   Purchase request ─► PO ─► Delivery ─► Stock ─► Issue to site     Tasks · Milestones · Attendance
          │                                          │                       │
          └──────────────── project cost ◄───────────┴───────────────────────┘
                                   │
   Milestone reached ─► Invoice ─► Approval ─► Payment ─► Project profit & receivables
```

## 1. Lead → client
1. **Create lead** (Sales, or import). A lead created by Management without an owner is **auto-assigned to the salesperson with the fewest open leads**; Sales always own what they create. The owner is notified.
2. Log calls/WhatsApp/notes (a call on a *New* lead moves it to *Contacted*), schedule a **follow-up date**. Follow-ups appear on the Follow-ups page and in the morning reminder.
3. **Schedule a site visit** → lead moves to *Site visit scheduled*; marking the visit complete moves it to *Site visit completed* and sets the lead's next follow-up.
4. Stages can be changed by drag-and-drop on the pipeline board. Moving to **Lost requires a reason**.
5. **Convert to client** copies name, phone, email, address, requirement; running it twice never creates a duplicate.
6. Rule: a salesperson sees and edits only their own leads.

## 2. Quotation
1. Create with line items (category, unit, qty, rate, GST%), discount % and terms (templates available). **Totals are always recalculated on the server** – GST is computed per line after the proportional discount, so mixed GST rates are correct.
2. **Submit for approval** → Management (a quotation always needs Management or the Owner). The Owner's own quotation is auto-approved.
3. Rejected → returns to the preparer with the reason; edit and resubmit.
4. **Approved → Mark as sent** (lead moves to *Quotation sent*). Then Viewed / In negotiation / **Accepted** (lead becomes **Won**) / Rejected. Opening it in the client portal marks it *Viewed* automatically.
5. **Revise:** an approved/sent quotation can't be edited. *Revise* keeps the old version in history (number + total), bumps the revision, and sends it back to Draft for re-approval.
6. Unsent quotations past their validity date become **Expired** automatically.
7. **Accepted → Convert to project:** creates the project (contract value = taxable value, GST excluded), a draft BOQ copied from the lines (costs empty for the PM to fill), assigns the project manager and notifies them. Can be done once.

## 3. BOQ
1. Items carry **material, labour and other cost per unit** (internal) and a **selling rate**. Estimated cost = unit cost × quantity; margin = selling − cost.
2. Users without cost access (e.g. Sales, Designers) can edit quantities and selling rates, but cost columns are hidden *and preserved* – a tampered request cannot change them.
3. Import from Excel (template provided), export to Excel/PDF (client-safe PDF never shows costs). Link an item to a catalogue material to enable purchasing/consumption tracking.
4. **Approval** locks the BOQ. **Revise** creates `BOQ-00012-R2` (copy), marks the old one *Revised*. **Compare** shows added/removed/changed items and the effect on total, cost and margin.
5. *Set budget from BOQ* copies the estimated cost into the project budget.

## 4. Approvals (all documents)
Amount decides who must approve (limits editable in Settings → Company):

| | ≤ Level 1 (₹25,000) | ≤ Level 2 (₹1,00,000) | Above |
|---|---|---|---|
| Purchase request / PO / expense / vendor payment | Project Manager* | Management | Owner |
| Quotation / BOQ / invoice | Management | Management | Management |
| Leave | HR | HR | HR |

\*only for projects they manage. Nobody approves their own request (Owner excepted); a requester who already has the authority is auto-approved (audited). Rejection **requires a reason** and returns the document to its owner.

## 5. Purchasing
1. **Purchase request** (site/PM/anyone with access; can be pre-filled from a BOQ) → approval by value (estimated from catalogue cost).
2. **Purchase order** from an approved request or from scratch: vendor, project (cost is charged here), items, GST, delivery date, terms. Approval by PO total. After approval the order is **locked**; *Mark sent to vendor*; PDF for the vendor.
3. A PO that is cancelled returns its request to *Approved*. Orders with received material can't be cancelled, only closed (short-close).
4. Vendors can confirm / update the delivery date in their portal; procurement is notified.
5. Daily check flags orders past their delivery date.

## 6. Receiving and stock
1. **Receive material** against a PO: per item *received / damaged / rejected*. **Only accepted quantity enters stock**; you can't accept more than is still pending. PO becomes *Partially received* → *Received*.
2. Stock is a **ledger** – no one types quantities. Receive, issue, return, transfer, correct (+/−), damage, consume each add a ledger line; you can never remove more than is available, even if two people try at the same instant.
3. **Issue to site:** warehouse → the project's site store (created automatically). Cost = moving-average cost at that moment and is **charged to the project**. **Return from site** credits the project at the same cost.
4. **Consumed** (used up) reduces site stock; corrections and damage **require a reason**.
5. When total warehouse stock falls to the reorder level, Procurement and the Store keeper are alerted (once a day per material).
6. Project → Materials tab compares **BOQ plan vs purchased vs received vs issued vs consumed vs on-site vs still-to-buy**, flagging over-use.

## 7. Site labour and attendance
1. Supervisors/engineers mark each worker per site per day: Present / Half day / Absent / Leave + overtime hours. Workers can also **mark themselves from their phone** (with location if allowed).
2. A worker can be on **one site per day**; future dates are refused; re-marking updates, never duplicates.
3. The **wage for that day is calculated and frozen** on the record (daily rate, half-day, overtime at 1.5×, monthly staff pro-rated) so later wage changes never rewrite history. Contract workers cost nothing here – their contractor is paid through work orders.
4. Wages flow into **project labour cost**.
5. **Contractors:** work orders (agreed value, project) and payments. Payments can't exceed the work-order value and count as project vendor cost.

## 8. HR, leave and payroll
1. Employees get a salary structure (basic, HRA, allowances, deductions) – visible only to HR/Management/Owner.
2. **Leave:** employee applies (Sundays don't count; overlaps blocked) → HR decides. Approved unpaid leave, and paid leave beyond the monthly allowance, reduce pay.
3. **Run payroll** per month: gross − leave deduction + overtime + incentives/bonus − deductions (PF % and a fixed deduction only if configured). Re-running refreshes numbers but keeps manually added incentives/bonus; **no duplicates**. Payslip PDFs; each employee sees only their own.

## 9. Billing and collection
1. **Invoice** – from scratch, from a quotation, or **stage-wise from a project milestone** (billing % × contract value; the same milestone can't be billed twice).
2. Draft → *Submit for approval* (Management) → on approval it is **issued**. Issued invoices are locked; cancel instead (only if no payment).
3. **Record payment:** the invoice row is locked while checking, so simultaneous entries can't overpay. Paid amount and status (*Partially paid / Paid*) are always recomputed from the payment records. Reversing a payment restores the balance (audited).
4. Unpaid invoices past due become **Overdue** (daily), Accounts is alerted and – if WhatsApp auto-messages are on – the client gets a reminder (max one per invoice per week).
5. **Ageing** (not due, 1–30, 31–60, 61–90, 90+ days) for receivables and payables.

## 10. Expenses and vendor bills
- **Expense:** logged by anyone allowed (site staff included), optionally charged to a project. It counts towards project cost **only after approval**; rejected ones never count.
- **Vendor bill:** duplicate bill numbers per vendor are refused; a bill against a PO can't exceed the PO value (+2%). Payments: partial or full, balance-checked; **Accounts can pay up to the Management limit, anything larger needs the Owner**.

## 11. Support and warranty
1. Ticket from staff or from the **client portal**; warranty cover is worked out automatically (12 months from project completion) and can be overridden by Management.
2. Assigned to the project manager by default; status flow Open → Assigned → In progress → Waiting → **Resolved (resolution text required)** → Closed (can reopen).
3. Warranty claims (only on warranty tickets) are approved/declined by Management; declining needs a reason.

## 12. Daily automation
Runs by itself each day (first dashboard visit, or a scheduler): expire quotations · mark overdue invoices · invoice-due and vendor-bill reminders · follow-ups due · late purchase orders · project deadlines · task reminders · expiring documents · unowned leads. Every reminder is de-duplicated, so running it twice never spams anyone.

## 13. Client, vendor and worker experiences
- **Client:** sees only their own projects, progress, stages (can **approve a completed stage**), site photos and documents *shared with them*, sent quotations (**accept / request changes**), invoices and payments, raises support requests. Never sees costs or margins.
- **Vendor:** sees only their own POs, delivery status, bills and payments; confirms/updates delivery dates; messages procurement.
- **Worker (phone):** today's site and supervisor, one big *Mark attendance* button, own tasks (*Start / Done / Stuck*), *Need material* (becomes a purchase request for the project manager), *Report problem* (alerts supervisor and PM).

## 14. Daily site reports
1. Every live site (Execution → Handover) sends a **morning update** (people on site, today's plan, blockers) and an **evening report** (work done, photos, how much of the site is finished, material status, tomorrow's plan).
2. Deadlines (settings): morning **10:00** (outstation sites **9:30**), evening **19:00**, India time. Sending again the same day updates the report; a report sent after the deadline is marked **late**.
3. Photos are shrunk on the phone before upload and saved as the project's site photos. The evening report needs at least one.
4. **Material status** – *all here / shortage soon / work stopped*. Anything other than "all here", or any problem text, alerts the project manager at once; a shortage also alerts Procurement.
5. If a report is missing: the site team is reminded at the deadline, the **project manager after 1 hour**, **Owner/Management after 3 hours** – each once.
6. Directors see a **reporting discipline** table (sent / on time / missing per site over the last 6 working days).

## 15. Time limits
Every waiting step has a limit taken from the SOPs (editable in Settings → Time Limits): approvals 24 h · approved request → PO 24 h · approved PO → sent to vendor 24 h · site visit → quotation 24 h · invoice → first payment follow-up 72 h · expense claim verification 24 h · snag closure 168 h · client complaint taken up 24 h · task past due date 24 h.
The **Time Limits** page lists what is *due soon* (75% used) and *overdue*, with who it is waiting on. Escalation, once each: the owner when the limit passes → their manager (project manager, else Management) after half a limit (min 12 h) → Owner/Management after a full limit (min 48 h).

## 16. Measurement sheet and quotation terms
1. On any BOQ row, **Measure** opens the site measurement sheet (as on DSC's M-Sheet): description, length (ft + in), width (ft + in), qty, and a **Less** tick for deductions (openings, stairs, areas in another finish).
2. Area items (sqft / sqm) use length × width × qty; running items (rft / rmt) use length × qty; piece items use qty only. Inches must be under 12. The result can never be negative.
3. When a row has a sheet, its **quantity is calculated from it** – the server recomputes and ignores any typed number – and the row's total follows. Removing the sheet returns to a hand-typed quantity. Revisions keep the sheets.
4. A quotation created from a BOQ gets the company's **default payment terms** (Settings → Company; default *50% advance, 40% before handover, 10% within 15 days of final bill*). On any quotation, one click fills 50/40/10 (interiors), 50/50 (fixtures) or 40/30/20/10 (stage-wise), and the text stays editable.
5. The quotation PDF prints a **Summary of work** (amount per category, before GST) above the totals, then GST, grand total, payment terms and terms & conditions.

## 17. Material requests, challans and transfers between projects
1. **Notice rule** – material must be requested at least **2 days** ahead (setting; the SOP says 2–3). A request needed sooner can still be sent, but only with a **reason**; it is flagged *short notice*, raised to at least High priority, and the project manager and Procurement are told.
2. **Delivery challan photo** – when a delivery is recorded the store takes a photo of the challan; it is saved against the purchase order (compressed on the phone).
3. **Transfers** – material or workers moving to another project need the approval of the **project they leave** (its PM, or Management/Owner). A transfer raised by that PM or by Management is approved at once. Approval moves the stock between the two site stores **and the cost with it** (credit to the first project, charge to the second, at the same rate); workers are re-assigned. Both PMs, Procurement and Accounts are told. A requester can never approve their own transfer (except the Owner). "Emergency" lets Management approve and informs the PM.

## 18. Extra work and vendor-bill certification
1. **Extra work** (outside the agreed scope) is raised as a draft, priced by the PM and **sent to the client**. The client approves in their portal, or staff **record the client's written approval with proof** (signed letter, e-mail or message screenshot). **It cannot start until approved** – *Start work* refuses with "Client approval is missing". Completing it tells Accounts to bill it.
2. **Vendor bills must be certified before payment.** The project manager of the bill's project (or Management, for bills with no project) ticks that the supporting documents were checked and certifies it; only then can Accounts pay. Bills recorded before this rule existed are exempt. A bill waiting more than 2 days appears on the Time Limits board.

## 19. Project closure
At **Handover** a closure checklist of 15 items starts automatically (HR is told). Four are checked by the system – all vendor bills certified, site photos exist, no expense waiting for verification, lessons learned written. The rest need the document (handover letter, snag certificate, final-bill documents, measurements, warranties, test reports, launch photos, material reconciliation, final checklist) or the owner's confirmation. When all 15 are done HR sends the **closure report** (PDF: profitability, collection, vendor outstanding, checklist, lessons) to the directors; Management/Owner **approve and close** the project. Past 15 days an unfinished checklist is escalated.

## 20. Performance scorecards
Each project is scored out of 100: completed on time 25 · reporting discipline 15 · quality 15 · material 10 · within budget 10 · client satisfaction 10 · documents 10 · labour & safety 5. Facts come from records (dates, reports sent and on time, deliveries, budget, closure checklist); the PM records the judgement items (rework, snags, client rating, labour, wastage, safety). A delay outside the team's control is not held against them. Without a review the score is *provisional*. The page also averages scores per project manager and supervisor, and prints the evaluation form as a PDF.

## 21. Director reports
**Weekly** (announced every Monday 08:00): money to collect and to pay (overdue and due this week, client- and vendor-wise), 7-day cash forecast, 6-month cash flow, critical vendor payments (over 30 days overdue), high-risk outstanding (over 60 days late), bills awaiting certification, and what is running late by department. **Monthly**: turnover and collections, project margins (best and lowest), vendor performance and new vendors, projects closed. PDF for both.

## 22. HR rules
- **Leave policy** – regular leave (1–3 days) needs **15 days'** notice; more than 3 days is **long leave** needing **3 months'** notice and Management approval; medical/emergency leave needs no notice but a reason, reported within 7 days; beyond **30 days a year** the request needs the Owner's approval. All numbers are settings.
- **Advances** – recorded with a monthly recovery; payroll deducts it automatically, never twice for a month, and closes the advance when repaid. Management/Owner can write one off with a reason.
- **Keka** – the employee list can be imported straight from a Keka export (its column names, employee numbers and `03-Jun-2024` dates are understood).

## 23. GST
A document's tax is split into **CGST + SGST** (supplier and place of supply in the same state) or **IGST** (different states), per tax rate. Place of supply is chosen on the document, else taken from the client's GSTIN, else assumed to be DSC's own state (set DSC's GSTIN in Settings → Company). Printed on invoices, quotations and purchase orders, and listed in the **GST sales register** report (taxable value, CGST, SGST, IGST per invoice) for the CA.

## 24. Client's BOQ in, DSC quotation out (Excel)

1. Sales/Designer opens a draft BOQ and clicks **Import client's Excel**.
2. Upload the file the client sent (any layout). The app finds the table on every sheet, the columns, section headings and units, ignores totals/GST/notes, and shows a preview. Nothing is saved yet.
3. Tick the sheets, choose add/replace, optionally keep the client's rates, click Import. Rows marked with a warning (for example quantity "RO") were adjusted: check them.
4. Fill in DSC's rates on the BOQ page, create the quotation as usual.
5. On the quotation page click **Excel**: a workbook with the DSC letterhead (logo, GSTIN, bank details), a summary of work, CGST/SGST or IGST, payment terms and a "BOQ details" sheet with live formulas. Clients and vendors cannot download it.

## 25. Client rates and profit (rate cards)

Each client company has its own rate card: DSC's cost per unit (per sq ft, rft, nos …) for the items it usually quotes, and the profit % added on cost for that client.

1. On a BOQ choose the client (or pick it when creating the BOQ).
2. Type the cost per unit in Material / Labour / Other. The selling rate (cost + profit %), row totals and BOQ total are calculated automatically. Typing a selling rate by hand switches that row to manual.
3. Press **Remember these rates for the client** to save them as the client's rate card.
4. Next BOQ for the same client: the app asks **"Use the same rates as last time?"** Yes fills every matching row (by name and unit) and sets the saved profit; **View / change** opens the rate card; **Start fresh** skips it. New items are left empty.
5. **Sales → Client rates** lists every client's card and lets you edit it directly.

Only people who may see margins (Owner, Management, Project Manager, Accounts) can see or use rate cards; the Designer and Sales roles can pick the client but never see costs or profit.

## 26. Saving and clearing the data

- `npm run data:clear` saves a full copy of this computer's database to `backups/<date-time>/` (JSON, one file per table, plus uploaded files), checks the copy, and then clears all business data. It keeps the company, its settings, permissions, Terms & Conditions templates and staff logins.
- `npm run data:clear-hosted` does the same to the online database (asks for its address and for the word CLEAR).
- `npm run data:restore -- "<backup folder>"` (or `data:restore-hosted`) puts a saved copy back.
