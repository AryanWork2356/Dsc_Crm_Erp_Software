import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createInvoice, updateInvoice, submitInvoice, cancelInvoice, invoiceFromMilestone, recordPayment, deletePayment, createExpense, createVendorBill, payVendorBill } from "@/app/(app)/finance/actions";
import { approveRequest, rejectRequest } from "@/app/(app)/approvals/actions";
import { receivables, payables, monthlyCashFlow } from "@/lib/finance-stats";
import { projectFinancials } from "@/lib/project-finance";

beforeEach(() => logout());
const lines = (rows: object[]) => JSON.stringify(rows);
const line = (description: string, quantity: number, rate: number, taxPercent = 18) => ({ description, unit: "nos", quantity, rate, taxPercent });
const proj = (code: string) => db.project.findFirstOrThrow({ where: { code } });
const cid = async () => (await db.client.findFirstOrThrow({ where: { name: "Rahul Bhatia" } })).id;
const today = new Date().toISOString().slice(0, 10);

async function issued(amountExGst: number) {
  await loginAs("accounts@dsc.demo");
  const r = await createInvoice(fd({ clientId: await cid(), issueDate: today, dueDate: "2030-01-01", items: lines([line(`Test invoice ${amountExGst}`, 1, amountExGst)]) }));
  expect(r.ok).toBe(true);
  const inv = await db.invoice.findFirstOrThrow({ where: { items: { some: { description: `Test invoice ${amountExGst}` } } } });
  await submitInvoice(inv.id);
  await loginAs("director@dsc.demo");
  const ap = await db.approval.findFirstOrThrow({ where: { entityId: inv.id, status: "PENDING" } });
  expect((await approveRequest(ap.id)).ok).toBe(true);
  return db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
}

describe("invoices", () => {
  it("computes totals on the server, starts as draft and is locked once submitted", async () => {
    await loginAs("accounts@dsc.demo");
    const r = await createInvoice(fd({ clientId: await cid(), issueDate: today, discountPct: 5, items: lines([line("Draft check", 2, 50000), line("Second", 1, 10000, 5)]), total: 1 }));
    expect(r.ok).toBe(true);
    const inv = await db.invoice.findFirstOrThrow({ where: { items: { some: { description: "Draft check" } } } });
    // subtotal 110000, 5% = 5500 off; GST: 100000×0.95=95000@18% = 17100, 10000×0.95=9500@5% = 475
    expect(Number(inv.subtotal)).toBe(110000);
    expect(Number(inv.discount)).toBe(5500);
    expect(Number(inv.taxAmount)).toBe(17575);
    expect(Number(inv.total)).toBe(122075);
    expect(inv.status).toBe("DRAFT");
    expect(inv.number).toMatch(/^INV-\d{5}$/);
    expect((await updateInvoice(inv.id, fd({ clientId: inv.clientId, issueDate: today, items: lines([line("Draft check", 1, 1000)]) }))).ok).toBe(true);
    await submitInvoice(inv.id);
    expect((await updateInvoice(inv.id, fd({ clientId: inv.clientId, issueDate: today, items: lines([line("Sneaky", 1, 1)]) }))).ok).toBe(false);
  });

  it("rejects bad input: empty lines, due before issue, project of another client", async () => {
    await loginAs("accounts@dsc.demo");
    expect((await createInvoice(fd({ clientId: await cid(), issueDate: today, items: lines([]) }))).ok).toBe(false);
    expect((await createInvoice(fd({ clientId: await cid(), issueDate: today, dueDate: "2000-01-01", items: lines([line("x", 1, 1)]) }))).ok).toBe(false);
    const p1 = await proj("PRJ-00001"); // belongs to a different client than Rahul
    expect((await createInvoice(fd({ clientId: await cid(), projectId: p1.id, issueDate: today, items: lines([line("x", 1, 1)]) }))).ok).toBe(false);
  });

  it("needs Management approval before it is issued; sales can't create invoices", async () => {
    await loginAs("sales@dsc.demo");
    expect((await createInvoice(fd({ clientId: await cid(), issueDate: today, items: lines([line("x", 1, 1)]) }))).ok).toBe(false);
    const inv = await issued(10000);
    expect(inv.status).toBe("SENT");
  });

  it("rejection returns the invoice to draft", async () => {
    await loginAs("accounts@dsc.demo");
    await createInvoice(fd({ clientId: await cid(), issueDate: today, items: lines([line("Reject me", 1, 5000)]) }));
    const inv = await db.invoice.findFirstOrThrow({ where: { items: { some: { description: "Reject me" } } } });
    await submitInvoice(inv.id);
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: inv.id, status: "PENDING" } });
    await loginAs("director@dsc.demo");
    expect((await rejectRequest(ap.id, fd({ remarks: "Wrong GST rate" }))).ok).toBe(true);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("DRAFT");
  });
});

describe("payments", () => {
  it("partial then full payment settles the invoice; the balance never goes wrong", async () => {
    const inv = await issued(100000); // total 118,000
    await loginAs("accounts@dsc.demo");
    expect((await recordPayment(fd({ invoiceId: inv.id, amount: 50000, date: today, method: "UPI", reference: "U1" }))).ok).toBe(true);
    let cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur.status).toBe("PARTIALLY_PAID");
    expect(Number(cur.paid)).toBe(50000);
    const over = await recordPayment(fd({ invoiceId: inv.id, amount: 70000, date: today }));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/68,000/);
    expect((await recordPayment(fd({ invoiceId: inv.id, amount: 68000, date: today }))).ok).toBe(true);
    cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(cur.status).toBe("PAID");
    expect(Number(cur.paid)).toBe(118000);
    expect((await recordPayment(fd({ invoiceId: inv.id, amount: 1, date: today }))).ok).toBe(false); // nothing left
  });

  it("reversing a payment restores the balance and status", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { items: { some: { description: "Test invoice 100000" } } }, include: { payments: true } });
    const last = inv.payments.find((p) => Number(p.amount) === 68000)!;
    await loginAs("sales@dsc.demo");
    expect((await deletePayment(last.id)).ok).toBe(false);
    await loginAs("accounts@dsc.demo"); // finance can reverse a payment – it is audited
    expect((await deletePayment(last.id)).ok).toBe(true);
    expect(await db.auditLog.count({ where: { entityId: last.id, action: "DELETE" } })).toBe(1);
    const cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(Number(cur.paid)).toBe(50000);
    expect(cur.status).toBe("PARTIALLY_PAID");
  });

  it("cannot take payment on drafts/cancelled invoices, or cancel an invoice that has payments", async () => {
    await loginAs("accounts@dsc.demo");
    await createInvoice(fd({ clientId: await cid(), issueDate: today, items: lines([line("Never issued", 1, 5000)]) }));
    const draft = await db.invoice.findFirstOrThrow({ where: { items: { some: { description: "Never issued" } } } });
    expect((await recordPayment(fd({ invoiceId: draft.id, amount: 100, date: today }))).ok).toBe(false);
    const paid = await db.invoice.findFirstOrThrow({ where: { items: { some: { description: "Test invoice 100000" } } } });
    await loginAs("owner@dsc.demo");
    expect((await cancelInvoice(paid.id)).ok).toBe(false);
    expect((await cancelInvoice(draft.id, fd({ reason: "Raised by mistake" }))).ok).toBe(true);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("CANCELLED");
  });

  it("two simultaneous payments cannot both exceed the balance", async () => {
    const inv = await issued(20000); // total 23,600
    await loginAs("accounts@dsc.demo");
    const results = await Promise.all([1, 2, 3].map(() => recordPayment(fd({ invoiceId: inv.id, amount: 15000, date: today }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const cur = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(Number(cur.paid)).toBe(15000);
    expect(await db.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
  });

  it("only finance roles can record payments", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { items: { some: { description: "Test invoice 100000" } } } });
    await loginAs("pm@dsc.demo");
    expect((await recordPayment(fd({ invoiceId: inv.id, amount: 100, date: today }))).ok).toBe(false);
    await loginAs("sales@dsc.demo");
    expect((await recordPayment(fd({ invoiceId: inv.id, amount: 100, date: today }))).ok).toBe(false);
  });
});

describe("stage-wise billing from milestones", () => {
  it("bills the milestone's share of the contract value once", async () => {
    await loginAs("accounts@dsc.demo");
    const p = await proj("PRJ-00004");
    const m = await db.projectMilestone.findFirstOrThrow({ where: { projectId: p.id, name: "Advance / mobilisation" } }); // 30%
    const r = await invoiceFromMilestone(m.id);
    expect(r.ok).toBe(true);
    const inv = await db.invoice.findFirstOrThrow({ where: { projectId: p.id, items: { some: { description: { startsWith: "Advance / mobilisation –" } } } }, include: { items: true } });
    const expected = Math.round(Number(p.contractValue) * 0.3 * 100) / 100;
    expect(Number(inv.subtotal)).toBe(expected);
    expect(Number(inv.total)).toBe(Math.round(expected * 1.18 * 100) / 100);
    expect(inv.status).toBe("DRAFT");
    expect((await invoiceFromMilestone(m.id)).ok).toBe(false); // already invoiced
    const zero = await db.projectMilestone.create({ data: { companyId: p.companyId, projectId: p.id, name: "No billing", billingPct: 0 } });
    expect((await invoiceFromMilestone(zero.id)).ok).toBe(false);
  });
});

describe("expenses and project cost", () => {
  it("an expense counts towards project cost only once approved", async () => {
    const p = await proj("PRJ-00002");
    const before = (await projectFinancials(p.companyId, [p.id])).get(p.id)!;
    await loginAs("engineer@dsc.demo");
    const r = await createExpense(fd({ description: "Test site expense", amount: 40000, date: today, category: "PROJECT", projectId: p.id }));
    expect(r.ok).toBe(true);
    const e = await db.expense.findFirstOrThrow({ where: { description: "Test site expense" } });
    expect(e.approved).toBe(false);
    expect((await projectFinancials(p.companyId, [p.id])).get(p.id)!.actualCost).toBe(before.actualCost); // not yet
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: e.id, status: "PENDING" } });
    expect(ap.requiredRole).toBe("MANAGEMENT"); // ₹40,000 is above the ₹25,000 PM limit
    await loginAs("director@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(true);
    const after = (await projectFinancials(p.companyId, [p.id])).get(p.id)!;
    expect(after.actualCost - before.actualCost).toBe(40000);
    expect(after.other - before.other).toBe(40000);
  });

  it("a rejected expense never counts; small expenses on your own project are auto-approved for the PM", async () => {
    const p = await proj("PRJ-00001"); // Amit's
    await loginAs("engineer@dsc.demo");
    await createExpense(fd({ description: "Rejected expense", amount: 60000, date: today, category: "MISC", projectId: p.id }));
    const e = await db.expense.findFirstOrThrow({ where: { description: "Rejected expense" } });
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: e.id, status: "PENDING" } });
    await loginAs("director@dsc.demo");
    await rejectRequest(ap.id, fd({ remarks: "No bill attached" }));
    const rej = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(rej.approved).toBe(false);
    expect(rej.rejectedAt).not.toBeNull();

    await loginAs("pm@dsc.demo");
    await createExpense(fd({ description: "PM small expense", amount: 5000, date: today, category: "TRAVEL", projectId: p.id }));
    expect((await db.expense.findFirstOrThrow({ where: { description: "PM small expense" } })).approved).toBe(true);
    // a PM does not get auto-approval on a project they don't manage
    const other = await proj("PRJ-00002");
    expect((await createExpense(fd({ description: "PM wrong project", amount: 5000, date: today, projectId: other.id }))).ok).toBe(false); // no access to that project
  });

  it("validates amount, date and the project requirement", async () => {
    await loginAs("accounts@dsc.demo");
    expect((await createExpense(fd({ description: "x", amount: 0, date: today }))).ok).toBe(false);
    expect((await createExpense(fd({ description: "x", amount: 100, date: "2099-01-01" }))).ok).toBe(false);
    expect((await createExpense(fd({ description: "x", amount: 100, date: today, category: "PROJECT" }))).ok).toBe(false);
  });
});

describe("vendor bills and payments", () => {
  it("rejects duplicate bill numbers and bills that exceed the PO", async () => {
    await loginAs("accounts@dsc.demo");
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { status: "RECEIVED" }, include: { vendor: true } });
    const existing = await db.vendorBill.findFirstOrThrow({ where: { poId: po.id } });
    expect((await createVendorBill(fd({ vendorId: po.vendorId, number: existing.number, billDate: today, amount: 10 }))).ok).toBe(false);
    expect((await createVendorBill(fd({ vendorId: po.vendorId, number: "EXTRA-1", poId: po.id, billDate: today, amount: Number(po.total) * 2 }))).ok).toBe(false);
    const other = await db.vendor.findFirstOrThrow({ where: { id: { not: po.vendorId } } });
    expect((await createVendorBill(fd({ vendorId: other.id, number: "WRONG-1", poId: po.id, billDate: today, amount: 10 }))).ok).toBe(false);
  });

  it("partial then full vendor payment updates the bill; overpaying is refused", async () => {
    await loginAs("accounts@dsc.demo");
    const v = await db.vendor.findFirstOrThrow({ where: { name: { startsWith: "Asian" } } });
    expect((await createVendorBill(fd({ vendorId: v.id, number: "AC/9001", billDate: today, dueDate: "2020-01-01", amount: 40000 }))).ok).toBe(true);
    const b = await db.vendorBill.findFirstOrThrow({ where: { number: "AC/9001" } });
    expect((await payVendorBill(fd({ billId: b.id, amount: 15000, date: today }))).ok).toBe(true);
    expect((await db.vendorBill.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PARTIALLY_PAID");
    expect((await payVendorBill(fd({ billId: b.id, amount: 30000, date: today }))).ok).toBe(false);
    expect((await payVendorBill(fd({ billId: b.id, amount: 25000, date: today }))).ok).toBe(true);
    const done = await db.vendorBill.findUniqueOrThrow({ where: { id: b.id } });
    expect(done.status).toBe("PAID");
    expect(Number(done.paid)).toBe(40000);
  });

  it("accounts can't make a payment above the Management limit; the Owner can", async () => {
    await loginAs("accounts@dsc.demo");
    const v = await db.vendor.findFirstOrThrow({ where: { name: { startsWith: "Greenply" } } });
    await createVendorBill(fd({ vendorId: v.id, number: "GP/BIG", billDate: today, amount: 500000 }));
    const b = await db.vendorBill.findFirstOrThrow({ where: { number: "GP/BIG" } });
    expect((await payVendorBill(fd({ billId: b.id, amount: 200000, date: today }))).ok).toBe(false); // above ₹1,00,000
    expect((await payVendorBill(fd({ billId: b.id, amount: 90000, date: today }))).ok).toBe(true);
    await loginAs("owner@dsc.demo");
    expect((await payVendorBill(fd({ billId: b.id, amount: 200000, date: today }))).ok).toBe(true);
  });

  it("only users with vendor bill rights can record bills", async () => {
    await loginAs("pm@dsc.demo");
    const v = await db.vendor.findFirstOrThrow({});
    expect((await createVendorBill(fd({ vendorId: v.id, number: "PM-1", billDate: today, amount: 10 }))).ok).toBe(false);
  });
});

describe("receivables, payables and cash flow", () => {
  it("receivables match open invoice balances and overdue is by due date", async () => {
    const companyId = (await db.company.findFirstOrThrow()).id;
    const r = await receivables(companyId);
    const open = await db.invoice.findMany({ where: { companyId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } });
    const expected = open.reduce((s, i) => s + Number(i.total) - Number(i.paid), 0);
    expect(r.total).toBeCloseTo(expected, 2);
    expect(r.overdueTotal).toBeGreaterThan(0);
    expect(r.aging.reduce((s, a) => s + a.total, 0)).toBeCloseTo(r.total, 2);
  });

  it("payables equal unpaid vendor bill balances", async () => {
    const companyId = (await db.company.findFirstOrThrow()).id;
    const p = await payables(companyId);
    const bills = await db.vendorBill.findMany({ where: { companyId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } } });
    expect(p.total).toBeCloseTo(bills.reduce((s, b) => s + Number(b.amount) - Number(b.paid), 0), 2);
  });

  it("monthly cash flow income equals the payments received that month", async () => {
    const companyId = (await db.company.findFirstOrThrow()).id;
    const flow = await monthlyCashFlow(companyId, 6);
    expect(flow).toHaveLength(6);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const agg = await db.payment.aggregate({ where: { companyId, date: { gte: start } }, _sum: { amount: true } });
    expect(flow.reduce((s, m) => s + m.income, 0)).toBeCloseTo(Number(agg._sum.amount), 2);
    expect(flow.every((m) => m.expenses >= 0)).toBe(true);
  });
});
