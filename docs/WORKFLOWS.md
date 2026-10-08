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
