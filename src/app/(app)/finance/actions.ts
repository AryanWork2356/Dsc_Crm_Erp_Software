"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ExpenseCategory, PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextDocNumber } from "@/lib/sequence";
import { canDecide, requestApproval, requiredRoleFor } from "@/lib/workflow";
import { settleInvoice } from "@/lib/invoice-settle";
import { computeTotals } from "@/lib/money";
import { projectScope } from "@/lib/scope";
import { formToObject, zDate, zOptDate, zOptStr, zReqStr } from "@/lib/form";
import { num, round2 } from "@/lib/utils";

function refresh() {
  for (const p of ["/finance/invoices", "/finance/payments", "/finance/expenses", "/finance/receivables", "/finance/payables", "/finance/bills", "/dashboard", "/projects"]) revalidatePath(p);
}

// ───────────────────────── INVOICES ─────────────────────────
const lineSchema = z.object({
  description: zReqStr("Describe each line"),
  unit: z.string().trim().min(1).default("nos"),
  quantity: z.coerce.number({ message: "Enter a quantity" }).positive("Quantity must be above 0"),
  rate: z.coerce.number({ message: "Enter a rate" }).min(0),
  taxPercent: z.coerce.number().min(0).max(100).default(18),
});

const invoiceSchema = z.object({
  clientId: zReqStr("Select a client"),
  projectId: zOptStr,
  quotationId: zOptStr,
  issueDate: zDate("Pick the invoice date"),
  dueDate: zOptDate,
  paymentTerms: zOptStr,
  notes: zOptStr,
  discountPct: z.coerce.number().min(0).max(100).default(0),
});

function parseLines(raw: unknown) {
  let v: unknown;
  try {
    v = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new UserError("Line items could not be read. Please reload the page.");
  }
  const p = z.array(lineSchema).min(1, "Add at least one line").safeParse(v);
  if (!p.success) throw new UserError(p.error.issues[0].message);
  return p.data;
}

async function invoiceRows(items: z.infer<typeof lineSchema>[], discountPct: number) {
  const t = computeTotals(items.map((i) => ({ quantity: i.quantity, rate: i.rate, taxPercent: i.taxPercent })), { pct: discountPct });
  return { t, rows: items.map((i, idx) => ({ description: i.description, unit: i.unit, quantity: i.quantity, rate: i.rate, taxPercent: i.taxPercent, amount: t.lines[idx].amount })) };
}

async function checkProjectClient(c: Ctx, projectId: string | undefined, clientId: string) {
  if (!projectId) return;
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) } });
  if (!p) throw new UserError("Project not found or you don't have access to it.");
  if (p.clientId !== clientId) throw new UserError("That project belongs to a different client.");
}

export async function createInvoice(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("invoices:create");
    const raw = formToObject(fd);
    const d = invoiceSchema.parse(raw);
    const items = parseLines(raw.items);
    if (d.dueDate && d.dueDate < d.issueDate) throw new UserError("The due date can't be before the invoice date.");
    const client = await db.client.findFirst({ where: { id: d.clientId, companyId: c.companyId, deletedAt: null } });
    if (!client) throw new UserError("Client not found.");
    await checkProjectClient(c, d.projectId, d.clientId);
    const { t, rows } = await invoiceRows(items, d.discountPct);
    const inv = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, c.companyId, "invoice");
      const x = await tx.invoice.create({
        data: { companyId: c.companyId, number, clientId: d.clientId, projectId: d.projectId ?? null, quotationId: d.quotationId ?? null, issueDate: d.issueDate, dueDate: d.dueDate, paymentTerms: d.paymentTerms, notes: d.notes, subtotal: t.subtotal, discount: t.discount, taxAmount: t.tax, total: t.total, items: { create: rows } },
      });
      await audit(c, { action: "CREATE", entityType: "Invoice", entityId: x.id, summary: `Created invoice ${number} for ${client.name} – ₹${t.total.toLocaleString("en-IN")}` }, tx);
      return x;
    });
    refresh();
    return { message: `Invoice ${inv.number} saved`, data: { id: inv.id } };
  });
}

export async function updateInvoice(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("invoices:edit");
    const raw = formToObject(fd);
    const d = invoiceSchema.parse(raw);
    const items = parseLines(raw.items);
    const old = await db.invoice.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!old) throw new UserError("Invoice not found.");
    if (old.status !== "DRAFT") throw new UserError("Only draft invoices can be edited. Issued invoices are locked – cancel and re-issue if needed.");
    await checkProjectClient(c, d.projectId, d.clientId);
    const { t, rows } = await invoiceRows(items, d.discountPct);
    await db.$transaction(async (tx) => {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.update({ where: { id }, data: { clientId: d.clientId, projectId: d.projectId ?? null, issueDate: d.issueDate, dueDate: d.dueDate, paymentTerms: d.paymentTerms, notes: d.notes, subtotal: t.subtotal, discount: t.discount, taxAmount: t.tax, total: t.total, items: { create: rows } } });
      await audit(c, { action: "UPDATE", entityType: "Invoice", entityId: id, summary: num(old.total) !== t.total ? `${c.name} changed invoice ${old.number} from ₹${num(old.total).toLocaleString("en-IN")} to ₹${t.total.toLocaleString("en-IN")}` : `Updated invoice ${old.number}`, oldValue: { total: num(old.total) }, newValue: { total: t.total } }, tx);
    });
    refresh();
    revalidatePath(`/finance/invoices/${id}`);
    return { message: "Invoice saved", data: { id } };
  });
}

export async function submitInvoice(id: string) {
  return run(async () => {
    const c = await assertPerm("invoices:edit");
    const inv = await db.invoice.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { client: true } });
    if (!inv) throw new UserError("Invoice not found.");
    if (inv.status !== "DRAFT") throw new UserError("Only draft invoices can be submitted.");
    if (num(inv.total) <= 0) throw new UserError("The invoice has no value.");
    const r = await db.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
      return requestApproval(tx, c, { type: "INVOICE", entityType: "Invoice", entityId: id, title: `Invoice ${inv.number} – ${inv.client.name}`, amount: num(inv.total) });
    });
    refresh();
    revalidatePath(`/finance/invoices/${id}`);
    return { message: r.autoApproved ? "Approved and issued" : "Sent for approval" };
  });
}

export async function cancelInvoice(id: string, fd?: FormData) {
  return run(async () => {
    const c = await assertPerm("invoices:delete");
    const inv = await db.invoice.findFirst({ where: { id, companyId: c.companyId, deletedAt: null } });
    if (!inv) throw new UserError("Invoice not found.");
    if (inv.status === "CANCELLED") throw new UserError("Already cancelled.");
    if (num(inv.paid) > 0) throw new UserError("Payments have been recorded against this invoice. Reverse them first.");
    const reason = fd ? String(fd.get("reason") ?? "").trim() : "";
    await db.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", notes: reason ? `${inv.notes ? inv.notes + "\n" : ""}Cancelled: ${reason}` : inv.notes } });
      await tx.approval.updateMany({ where: { entityType: "Invoice", entityId: id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), remarks: "Invoice cancelled" } });
      await audit(c, { action: "UPDATE", entityType: "Invoice", entityId: id, summary: `Cancelled invoice ${inv.number}${reason ? ` – ${reason}` : ""}` }, tx);
    });
    refresh();
    revalidatePath(`/finance/invoices/${id}`);
    return { message: "Invoice cancelled" };
  });
}

/** Stage-wise billing: raises a draft invoice for a project milestone's share of the contract value. */
export async function invoiceFromMilestone(milestoneId: string) {
  return run(async () => {
    const c = await assertPerm("invoices:create");
    const m = await db.projectMilestone.findFirst({ where: { id: milestoneId, companyId: c.companyId }, include: { project: { include: { client: true } } } });
    if (!m) throw new UserError("Milestone not found.");
    if (num(m.billingPct) <= 0) throw new UserError("This milestone has no billing percentage.");
    const p = m.project;
    await checkProjectClient(c, p.id, p.clientId);
    const existing = await db.invoiceItem.findFirst({ where: { invoice: { projectId: p.id, status: { not: "CANCELLED" }, deletedAt: null }, description: { startsWith: `${m.name} –` } } });
    if (existing) throw new UserError("This milestone has already been invoiced.");
    const settings = await db.companySettings.findUnique({ where: { companyId: c.companyId } });
    const tax = num(settings?.defaultTaxPercent ?? 18);
    const amount = round2((num(p.contractValue) * num(m.billingPct)) / 100);
    if (amount <= 0) throw new UserError("The project has no contract value to bill against.");
    const billedPct = await db.projectMilestone.aggregate({ where: { projectId: p.id }, _sum: { billingPct: true } });
    if (num(billedPct._sum.billingPct) > 100.001) throw new UserError("Milestone percentages exceed 100%. Fix them first.");
    const { t, rows } = await invoiceRows([{ description: `${m.name} – ${num(m.billingPct)}% of contract (${p.name})`, unit: "lumpsum", quantity: 1, rate: amount, taxPercent: tax }], 0);
    const inv = await db.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, c.companyId, "invoice");
      const x = await tx.invoice.create({ data: { companyId: c.companyId, number, clientId: p.clientId, projectId: p.id, quotationId: p.quotationId, dueDate: new Date(Date.now() + 15 * 86400000), paymentTerms: "Payable within 15 days", subtotal: t.subtotal, discount: 0, taxAmount: t.tax, total: t.total, items: { create: rows } } });
      await audit(c, { action: "CREATE", entityType: "Invoice", entityId: x.id, summary: `Raised invoice ${number} for milestone “${m.name}” of ${p.code} (₹${t.total.toLocaleString("en-IN")})` }, tx);
      return x;
    });
    refresh();
    return { message: `Draft invoice ${inv.number} created`, data: { id: inv.id } };
  });
}

// ───────────────────────── CLIENT PAYMENTS ─────────────────────────
const paySchema = z.object({
  invoiceId: zReqStr("Select the invoice"),
  amount: z.coerce.number({ message: "Enter the amount" }).positive("Amount must be above 0"),
  date: zDate("Pick the payment date"),
  method: z.nativeEnum(PaymentMethod).default("BANK_TRANSFER"),
  reference: zOptStr,
  notes: zOptStr,
});

export async function recordPayment(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("payments:create");
    const d = paySchema.parse(formToObject(fd));
    const result = await db.$transaction(async (tx) => {
      // lock the invoice row so two simultaneous payments can't both pass the balance check
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Invoice" WHERE id = ${d.invoiceId} AND "companyId" = ${c.companyId} FOR UPDATE`;
      if (!rows.length) throw new UserError("Invoice not found.");
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: d.invoiceId }, include: { client: true } });
      if (["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(inv.status)) throw new UserError("Payments can only be recorded against issued invoices.");
      const balance = round2(num(inv.total) - num(inv.paid));
      if (d.amount > balance + 0.005) throw new UserError(`The balance on ${inv.number} is ₹${balance.toLocaleString("en-IN")}. You entered ₹${d.amount.toLocaleString("en-IN")}.`);
      const p = await tx.payment.create({ data: { companyId: c.companyId, invoiceId: d.invoiceId, amount: d.amount, date: d.date, method: d.method, reference: d.reference, notes: d.notes } });
      const s = await settleInvoice(tx, d.invoiceId);
      await audit(c, { action: "CREATE", entityType: "Payment", entityId: p.id, summary: `Received ₹${d.amount.toLocaleString("en-IN")} from ${inv.client.name} against ${inv.number} (${s.status.toLowerCase().replace("_", " ")})` }, tx);
      return { inv, s };
    });
    refresh();
    revalidatePath(`/finance/invoices/${d.invoiceId}`);
    return { message: result.s.status === "PAID" ? `Payment recorded – ${result.inv.number} is fully paid` : `Payment recorded – ₹${(result.s.total - result.s.paid).toLocaleString("en-IN")} still due` };
  });
}

export async function deletePayment(id: string) {
  return run(async () => {
    const c = await assertPerm("payments:delete");
    const p = await db.payment.findFirst({ where: { id, companyId: c.companyId }, include: { invoice: true } });
    if (!p) throw new UserError("Payment not found.");
    await db.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id } });
      await settleInvoice(tx, p.invoiceId);
      await audit(c, { action: "DELETE", entityType: "Payment", entityId: id, summary: `Reversed payment of ₹${num(p.amount).toLocaleString("en-IN")} on ${p.invoice.number}` }, tx);
    });
    refresh();
    return { message: "Payment reversed" };
  });
}

// ───────────────────────── EXPENSES ─────────────────────────
const expSchema = z.object({
  date: zDate("Pick the date"),
  category: z.nativeEnum(ExpenseCategory).default("MISC"),
  description: zReqStr("Describe the expense"),
  amount: z.coerce.number({ message: "Enter the amount" }).positive("Amount must be above 0"),
  projectId: zOptStr,
  paidBy: zOptStr,
  reference: zOptStr,
});

export async function createExpense(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("expenses:create");
    const d = expSchema.parse(formToObject(fd));
    if (d.category === "PROJECT" && !d.projectId) throw new UserError("Select the project this expense belongs to.");
    if (d.projectId && !(await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c) } }))) throw new UserError("Project not found or you don't have access to it.");
    if (d.date.getTime() > Date.now() + 86400000) throw new UserError("The expense date can't be in the future.");
    const e = await db.$transaction(async (tx) => {
      // Not counted in project cost until approved
      const x = await tx.expense.create({ data: { ...d, companyId: c.companyId, projectId: d.projectId ?? null, createdById: c.userId, approved: false } });
      const r = await requestApproval(tx, c, { type: "EXPENSE", entityType: "Expense", entityId: x.id, title: `Expense – ${d.description}`, amount: d.amount });
      await audit(c, { action: "CREATE", entityType: "Expense", entityId: x.id, summary: `Logged expense ₹${d.amount.toLocaleString("en-IN")} – ${d.description}${r.autoApproved ? " (auto-approved)" : ""}` }, tx);
      return { x, r };
    });
    refresh();
    return { message: e.r.autoApproved ? "Expense recorded" : "Expense sent for approval", data: { id: e.x.id } };
  });
}

export async function deleteExpense(id: string) {
  return run(async () => {
    const c = await assertPerm("expenses:delete");
    const e = await db.expense.findFirst({ where: { id, companyId: c.companyId } });
    if (!e) throw new UserError("Expense not found.");
    await db.$transaction(async (tx) => {
      await tx.approval.updateMany({ where: { entityType: "Expense", entityId: id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), remarks: "Expense deleted" } });
      await tx.expense.delete({ where: { id } });
      await audit(c, { action: "DELETE", entityType: "Expense", entityId: id, summary: `Deleted expense ₹${num(e.amount).toLocaleString("en-IN")} – ${e.description}` }, tx);
    });
    refresh();
    return { message: "Expense deleted" };
  });
}

// ───────────────────────── VENDOR BILLS & PAYMENTS ─────────────────────────
const billSchema = z.object({
  vendorId: zReqStr("Select the vendor"),
  number: zReqStr("Enter the vendor's bill number"),
  poId: zOptStr,
  projectId: zOptStr,
  billDate: zDate("Pick the bill date"),
  dueDate: zOptDate,
  amount: z.coerce.number({ message: "Enter the bill amount" }).positive("Amount must be above 0"),
  notes: zOptStr,
});

export async function createVendorBill(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("vendor_bills:create");
    const d = billSchema.parse(formToObject(fd));
    const vendor = await db.vendor.findFirst({ where: { id: d.vendorId, companyId: c.companyId, deletedAt: null } });
    if (!vendor) throw new UserError("Vendor not found.");
    if (await db.vendorBill.findFirst({ where: { companyId: c.companyId, vendorId: d.vendorId, number: d.number, status: { not: "CANCELLED" } } })) throw new UserError(`Bill ${d.number} from ${vendor.name} is already recorded.`);
    let projectId = d.projectId ?? null;
    if (d.poId) {
      const po = await db.purchaseOrder.findFirst({ where: { id: d.poId, companyId: c.companyId, vendorId: d.vendorId } });
      if (!po) throw new UserError("That purchase order doesn't belong to this vendor.");
      projectId = projectId ?? po.projectId;
      const billed = await db.vendorBill.aggregate({ where: { poId: po.id, status: { not: "CANCELLED" } }, _sum: { amount: true } });
      if (num(billed._sum.amount) + d.amount > num(po.total) * 1.02 + 0.01) throw new UserError(`Bills would total ₹${(num(billed._sum.amount) + d.amount).toLocaleString("en-IN")} against a PO of ₹${num(po.total).toLocaleString("en-IN")}.`);
    }
    const b = await db.vendorBill.create({ data: { companyId: c.companyId, number: d.number, vendorId: d.vendorId, poId: d.poId ?? null, projectId, billDate: d.billDate, dueDate: d.dueDate, amount: d.amount, notes: d.notes } });
    await audit(c, { action: "CREATE", entityType: "VendorBill", entityId: b.id, summary: `Recorded bill ${d.number} from ${vendor.name} – ₹${d.amount.toLocaleString("en-IN")}` });
    refresh();
    return { message: "Vendor bill recorded" };
  });
}

const vpSchema = z.object({
  billId: zReqStr("Select the bill"),
  amount: z.coerce.number({ message: "Enter the amount" }).positive("Amount must be above 0"),
  date: zDate("Pick the payment date"),
  method: z.nativeEnum(PaymentMethod).default("BANK_TRANSFER"),
  reference: zOptStr,
});

export async function payVendorBill(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("vendor_bills:edit");
    const d = vpSchema.parse(formToObject(fd));
    await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "VendorBill" WHERE id = ${d.billId} AND "companyId" = ${c.companyId} FOR UPDATE`;
      if (!rows.length) throw new UserError("Bill not found.");
      const b = await tx.vendorBill.findUniqueOrThrow({ where: { id: d.billId }, include: { vendor: true } });
      if (b.status === "CANCELLED") throw new UserError("This bill is cancelled.");
      const balance = round2(num(b.amount) - num(b.paid));
      if (d.amount > balance + 0.005) throw new UserError(`The balance on bill ${b.number} is ₹${balance.toLocaleString("en-IN")}.`);
      // Large vendor payments follow the approval thresholds: Accounts can pay up to the Management limit,
      // anything above needs the Owner.
      const required = await requiredRoleFor(c.companyId, "VENDOR_PAYMENT", d.amount, tx);
      if (!canDecide(c.role, required) && !(c.role === "ACCOUNTS" && required !== "OWNER")) throw new UserError(`A payment of ₹${d.amount.toLocaleString("en-IN")} needs ${required.replace("_", " ").toLowerCase()} authority.`);
      await tx.vendorPayment.create({ data: { companyId: c.companyId, vendorId: b.vendorId, billId: b.id, amount: d.amount, date: d.date, method: d.method, reference: d.reference } });
      const paid = round2(num(b.paid) + d.amount);
      await tx.vendorBill.update({ where: { id: b.id }, data: { paid, status: paid + 0.005 >= num(b.amount) ? "PAID" : "PARTIALLY_PAID" } });
      await audit(c, { action: "CREATE", entityType: "VendorPayment", entityId: b.id, summary: `Paid ₹${d.amount.toLocaleString("en-IN")} to ${b.vendor.name} against bill ${b.number}${d.reference ? ` (ref ${d.reference})` : ""}` }, tx);
    });
    refresh();
    return { message: "Vendor payment recorded" };
  });
}

export async function cancelVendorBill(id: string) {
  return run(async () => {
    const c = await assertPerm("vendor_bills:delete");
    const b = await db.vendorBill.findFirst({ where: { id, companyId: c.companyId } });
    if (!b) throw new UserError("Bill not found.");
    if (num(b.paid) > 0) throw new UserError("Payments have been made against this bill.");
    await db.vendorBill.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(c, { action: "UPDATE", entityType: "VendorBill", entityId: id, summary: `Cancelled vendor bill ${b.number}` });
    refresh();
    return { message: "Bill cancelled" };
  });
}
