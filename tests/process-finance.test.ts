import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";
import { loginAs, logout, fd } from "./setup";
import { createClientPO, setClientPoStatus, updateClientPO } from "@/app/(app)/crm/clients/po-actions";
import { createInvoice, createVendorBill, updateInvoice } from "@/app/(app)/finance/actions";
import { addCollectionNote } from "@/app/(app)/finance/collection-actions";
import { setEstimateToComplete } from "@/app/(app)/projects/actions";
import { clientAccount, billedAgainstPo } from "@/lib/client-account";
import { oneProjectFinancials } from "@/lib/project-finance";
import { exceptionReport } from "@/lib/exceptions";
import { getTimeLimitItems } from "@/lib/time-limits";

beforeEach(() => logout());

const DAY = 86400000;
const iso = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
const lines = (rows: object[]) => JSON.stringify(rows);
const line = (description: string, quantity: number, rate: number, taxPercent = 18) => ({ description, unit: "nos", quantity, rate, taxPercent });
let seq = 0;
const tag = () => `${Date.now().toString(36)}${seq++}`;

async function newClient() {
  const company = await db.company.findFirstOrThrow();
  const n = tag();
  return db.client.create({ data: { companyId: company.id, code: `CL-T${n}`, name: `PO client ${n}` } });
}

async function recordPo(clientId: string, amount: number, number = `PO-${tag()}`) {
  await loginAs("accounts@dsc.demo");
  const r = await createClientPO(fd({ clientId, number, amount, scopes: "Civil and interiors" }));
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return db.clientPO.findFirstOrThrow({ where: { clientId, number } });
}

const bill = (clientId: string, amount: number, extra: Record<string, string | number> = {}) =>
  createInvoice(fd({ clientId, issueDate: iso(0), dueDate: iso(30), items: lines([line(`Billing ${tag()}`, 1, amount)]), ...extra }));

describe("client purchase orders", () => {
  it("records a PO against a company and refuses the same number twice", async () => {
    const cl = await newClient();
    const po = await recordPo(cl.id, 500000, "PO-77");
    expect(Number(po.amount)).toBe(500000);
    expect(po.status).toBe("OPEN");
    const again = await createClientPO(fd({ clientId: cl.id, number: "PO-77", amount: 1000 }));
    expect(again.ok).toBe(false);
    expect((await createClientPO(fd({ clientId: cl.id, number: "PO-X", amount: 0 }))).ok).toBe(false);
    // the same number is fine for another company
    const other = await newClient();
    expect((await createClientPO(fd({ clientId: other.id, number: "PO-77", amount: 1000 }))).ok).toBe(true);
  });

  it("people who cannot bill or quote cannot record one", async () => {
    const cl = await newClient();
    await loginAs("supervisor@dsc.demo");
    expect((await createClientPO(fd({ clientId: cl.id, number: "PO-NO", amount: 1000 }))).ok).toBe(false);
  });

  it("billing can not go above the PO unless a reason is written, and the reason is kept", async () => {
    const cl = await newClient();
    const po = await recordPo(cl.id, 100000);
    expect((await bill(cl.id, 60000, { clientPoId: po.id })).ok).toBe(true);
    // 60,000 + 50,000 = 110,000 is above the PO of 100,000
    const over = await bill(cl.id, 50000, { clientPoId: po.id });
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.error).toMatch(/above the PO/);
    expect((await bill(cl.id, 50000, { clientPoId: po.id, overPoReason: "ok" })).ok).toBe(false); // too short to be a reason
    expect((await bill(cl.id, 50000, { clientPoId: po.id, overPoReason: "Client verbally added the corridor; amended PO is awaited" })).ok).toBe(true);
    const inv = await db.invoice.findFirstOrThrow({ where: { clientPoId: po.id, overPoNote: { not: null } } });
    expect(inv.overPoNote).toMatch(/amended PO/);
    expect(await billedAgainstPo(po.id)).toBeCloseTo(110000, 2);
  });

  it("an invoice cannot be tied to another company's PO or a cancelled PO", async () => {
    const a = await newClient();
    const b = await newClient();
    const poA = await recordPo(a.id, 100000);
    expect((await bill(b.id, 1000, { clientPoId: poA.id })).ok).toBe(false);
    await setClientPoStatus(poA.id, "CANCELLED", fd({ reason: "Client withdrew the order" }));
    expect((await db.clientPO.findUniqueOrThrow({ where: { id: poA.id } })).status).toBe("CANCELLED");
    expect((await bill(a.id, 1000, { clientPoId: poA.id })).ok).toBe(false);
  });

  it("editing a draft invoice is checked against the PO too, not counting itself twice", async () => {
    const cl = await newClient();
    const po = await recordPo(cl.id, 100000);
    expect((await bill(cl.id, 90000, { clientPoId: po.id })).ok).toBe(true);
    const inv = await db.invoice.findFirstOrThrow({ where: { clientPoId: po.id } });
    // raising the same invoice to 95,000 is still within the PO
    expect((await updateInvoice(inv.id, fd({ clientId: cl.id, clientPoId: po.id, issueDate: iso(0), items: lines([line("Revised", 1, 95000)]) }))).ok).toBe(true);
    // raising it to 120,000 is not
    expect((await updateInvoice(inv.id, fd({ clientId: cl.id, clientPoId: po.id, issueDate: iso(0), items: lines([line("Revised again", 1, 120000)]) }))).ok).toBe(false);
  });

  it("a PO's value cannot be cut below what is already billed, and a billed PO cannot be cancelled", async () => {
    const cl = await newClient();
    const po = await recordPo(cl.id, 100000);
    await bill(cl.id, 80000, { clientPoId: po.id });
    expect((await updateClientPO(po.id, fd({ number: po.number, amount: 50000 }))).ok).toBe(false);
    expect((await updateClientPO(po.id, fd({ number: po.number, amount: 150000, scopes: "Amended" }))).ok).toBe(true);
    expect((await setClientPoStatus(po.id, "CANCELLED", fd({ reason: "Changed our mind" }))).ok).toBe(false);
    expect((await setClientPoStatus(po.id, "CLOSED")).ok).toBe(true);
  });

  it("the company account shows PO, billed, received and what is left, counting issued invoices only", async () => {
    const cl = await newClient();
    const po = await recordPo(cl.id, 200000);
    await bill(cl.id, 100000, { clientPoId: po.id });
    const inv = await db.invoice.findFirstOrThrow({ where: { clientPoId: po.id } });
    // a draft is not billed yet
    let acc = await clientAccount(cl.companyId, cl.id);
    expect(acc.totals.poValue).toBe(200000);
    expect(acc.totals.billed).toBe(0);
    expect(acc.pos[0].committedBilling).toBeCloseTo(100000, 2);
    // once issued and part paid, the figures follow
    await db.invoice.update({ where: { id: inv.id }, data: { status: "PARTIALLY_PAID", paid: 40000 } });
    acc = await clientAccount(cl.companyId, cl.id);
    expect(acc.totals.billed).toBeCloseTo(100000, 2);
    expect(acc.totals.received).toBeCloseTo(40000, 2);
    expect(acc.totals.leftToBill).toBeCloseTo(100000, 2);
    expect(acc.totals.leftToCollect).toBeCloseTo(Number(inv.total) - 40000, 2);
  });
});

async function issuedInvoice(amount = 100000) {
  const cl = await newClient();
  await loginAs("accounts@dsc.demo");
  await bill(cl.id, amount);
  const inv = await db.invoice.findFirstOrThrow({ where: { clientId: cl.id } });
  return db.invoice.update({ where: { id: inv.id }, data: { status: "SENT", issueDate: new Date(Date.now() - 10 * DAY), dueDate: new Date(Date.now() - 2 * DAY) } });
}

describe("collection follow-ups", () => {
  it("needs a next step and date while money is due; a promise never marks the invoice paid", async () => {
    const inv = await issuedInvoice();
    expect((await addCollectionNote(inv.id, fd({ note: "Client says will pay soon" }))).ok).toBe(false);
    expect((await addCollectionNote(inv.id, fd({ note: "Spoke to accounts head", nextActionDate: iso(3) }))).ok).toBe(false); // what is missing
    const r = await addCollectionNote(inv.id, fd({ note: "Accounts head promised payment", promisedDate: iso(5), promisedAmount: 118000, nextAction: "Call accounts head", nextActionDate: iso(3) }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("SENT");
    expect(Number(after.paid)).toBe(0);
  });

  it("each follow-up replaces the previous one: only one open action stays on the invoice", async () => {
    const inv = await issuedInvoice();
    await addCollectionNote(inv.id, fd({ note: "First call", nextAction: "Call again", nextActionDate: iso(2) }));
    await addCollectionNote(inv.id, fd({ note: "Second call", nextAction: "Send statement", nextActionDate: iso(4) }));
    const open = await db.actionItem.findMany({ where: { sourceType: "Invoice", sourceId: inv.id, status: { in: ["OPEN", "IN_PROGRESS"] } } });
    expect(open).toHaveLength(1);
    expect(open[0].title).toMatch(/Send statement/);
    expect(await db.collectionNote.count({ where: { invoiceId: inv.id } })).toBe(2);
  });

  it("a promise date in the past is refused, and a missed promise shows on the exceptions report", async () => {
    const inv = await issuedInvoice();
    expect((await addCollectionNote(inv.id, fd({ note: "x promise", promisedDate: iso(-3), nextAction: "Call", nextActionDate: iso(1) }))).ok).toBe(false);
    // a promise that was made, then passed without payment
    const ownerId = (await db.user.findFirstOrThrow({ where: { email: "accounts@dsc.demo" } })).id;
    await db.collectionNote.create({ data: { companyId: inv.companyId, invoiceId: inv.id, note: "Will pay Friday", promisedDate: new Date(Date.now() - 2 * DAY), nextAction: "Call", nextActionDate: new Date(Date.now() + DAY), ownerId, createdById: ownerId } });
    await loginAs("owner@dsc.demo");
    const rep = await exceptionReport((await getCtx())!);
    expect(rep.sections.find((s) => s.key === "promise_missed")?.rows.some((r) => r.id === inv.id)).toBe(true);
  });

  it("the follow-up clock restarts at the last follow-up", async () => {
    const inv = await issuedInvoice();
    await loginAs("owner@dsc.demo");
    const ctx = (await getCtx())!;
    const find = async () => (await getTimeLimitItems(ctx.companyId)).some((i) => i.ruleKey === "invoice_followup" && i.id === inv.id);
    expect(await find()).toBe(true); // issued 10 days ago and never followed up
    const ownerId = (await db.user.findFirstOrThrow({ where: { email: "accounts@dsc.demo" } })).id;
    await db.collectionNote.create({ data: { companyId: inv.companyId, invoiceId: inv.id, note: "Called", nextAction: "Call again", nextActionDate: new Date(Date.now() + 5 * DAY), ownerId, createdById: ownerId } });
    expect(await find()).toBe(false); // next follow-up is not due yet
  });

  it("only people who can edit invoices can record a follow-up", async () => {
    const inv = await issuedInvoice();
    await loginAs("supervisor@dsc.demo");
    expect((await addCollectionNote(inv.id, fd({ note: "x", nextAction: "Call", nextActionDate: iso(1) }))).ok).toBe(false);
  });
});

describe("forecast final cost", () => {
  async function site() {
    const company = await db.company.findFirstOrThrow();
    const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
    const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
    const vendor = await db.vendor.findFirstOrThrow({ where: { deletedAt: null } });
    const project = await db.project.create({ data: { companyId: company.id, code: `PRJ-F${tag()}`, name: "Forecast site", clientId: client.id, status: "EXECUTION", projectManagerId: pm.id, contractValue: 1000000, budget: 700000, members: { create: [{ userId: pm.id, roleLabel: "PM" }] } } });
    return { company, pm, vendor, project };
  }

  it("counts what is still to be delivered once, adds the estimate, and ignores closed orders", async () => {
    const { company, vendor, project } = await site();
    const by = (await db.user.findFirstOrThrow({ where: { email: "procurement@dsc.demo" } })).id;
    const mk = (status: "SENT_TO_VENDOR" | "CLOSED", received: number) =>
      db.purchaseOrder.create({ data: { companyId: company.id, number: `PO-F${tag()}`, vendorId: vendor.id, projectId: project.id, status, createdById: by, items: { create: [{ description: "Plywood", unit: "nos", quantity: 100, receivedQty: received, rate: 1000, amount: 100000 }] } } });
    await mk("SENT_TO_VENDOR", 40); // 60 still to come = 60,000
    await mk("CLOSED", 0); // closed: nothing is expected
    let fin = (await oneProjectFinancials(company.id, project.id))!;
    expect(fin.committed).toBeCloseTo(60000, 2);
    expect(fin.forecastFinal).toBeCloseTo(fin.actualCost + 60000, 2);

    await loginAs("director@dsc.demo");
    expect((await setEstimateToComplete(project.id, fd({ amount: 120000, note: "Paint and lights" }))).ok).toBe(true);
    fin = (await oneProjectFinancials(company.id, project.id))!;
    expect(fin.estimateToComplete).toBe(120000);
    expect(fin.forecastFinal).toBeCloseTo(fin.actualCost + 60000 + 120000, 2);
    expect(fin.forecastVariance).toBeCloseTo(fin.forecastFinal - 700000, 2);
  });

  it("the supplier's bill for an order is not added on top of the order", async () => {
    const { company, vendor, project } = await site();
    const by = (await db.user.findFirstOrThrow({ where: { email: "procurement@dsc.demo" } })).id;
    const po = await db.purchaseOrder.create({ data: { companyId: company.id, number: `PO-F${tag()}`, vendorId: vendor.id, projectId: project.id, status: "SENT_TO_VENDOR", createdById: by, items: { create: [{ description: "Tiles", unit: "box", quantity: 50, receivedQty: 0, rate: 2000, amount: 100000 }] } } });
    const before = (await oneProjectFinancials(company.id, project.id))!;
    await db.vendorBill.create({ data: { companyId: company.id, number: `B-${tag()}`, vendorId: vendor.id, poId: po.id, projectId: project.id, amount: 118000 } });
    const after = (await oneProjectFinancials(company.id, project.id))!;
    expect(after.forecastFinal).toBeCloseTo(before.forecastFinal, 2);
    expect(after.actualCost).toBeCloseTo(before.actualCost, 2);
  });

  it("the estimate needs access to costs, and a negative number is refused", async () => {
    const { project } = await site();
    await loginAs("supervisor@dsc.demo");
    expect((await setEstimateToComplete(project.id, fd({ amount: 1000 }))).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await setEstimateToComplete(project.id, fd({ amount: -5 }))).ok).toBe(false);
  });

  it("flags a forecast that is above the contract value as a loss", async () => {
    const { company, project } = await site();
    await db.project.update({ where: { id: project.id }, data: { estimateToComplete: 1200000 } });
    const fin = (await oneProjectFinancials(company.id, project.id))!;
    expect(fin.forecastLoss).toBe(true);
    expect(fin.forecastOverBudget).toBe(true);
    await loginAs("owner@dsc.demo");
    const rep = await exceptionReport((await getCtx())!);
    expect(rep.sections.find((s) => s.key === "forecast_loss")?.rows.some((r) => r.id === project.id)).toBe(true);
  });
});

describe("vendor bill checks", () => {
  const mkBill = (fields: Record<string, string | number>) => createVendorBill(fd({ billDate: iso(0), ...fields }));
  async function vendorAndPo(received: number) {
    const company = await db.company.findFirstOrThrow();
    const by = (await db.user.findFirstOrThrow({ where: { email: "procurement@dsc.demo" } })).id;
    const vendor = await db.vendor.create({ data: { companyId: company.id, code: `V-B${tag()}`, name: `Bill vendor ${tag()}` } });
    const po = await db.purchaseOrder.create({ data: { companyId: company.id, number: `PO-B${tag()}`, vendorId: vendor.id, status: "SENT_TO_VENDOR", total: 118000, createdById: by, items: { create: [{ description: "Tiles", unit: "box", quantity: 100, receivedQty: received, rate: 1000, amount: 100000, taxPercent: 18 }] } } });
    return { vendor, po };
  }

  it("a look-alike bill (same vendor, amount and nearly the same date) needs a written reason", async () => {
    const { vendor } = await vendorAndPo(100);
    await loginAs("accounts@dsc.demo");
    expect((await mkBill({ vendorId: vendor.id, number: "INV-100", amount: 45000 })).ok).toBe(true);
    const again = await mkBill({ vendorId: vendor.id, number: "INV-100-A", amount: 45000 });
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error).toMatch(/same bill/);
    expect((await mkBill({ vendorId: vendor.id, number: "INV-100-A", amount: 45000, overrideReason: "Second delivery, same value" })).ok).toBe(true);
    const kept = await db.vendorBill.findFirstOrThrow({ where: { vendorId: vendor.id, number: "INV-100-A" } });
    expect(kept.notes).toMatch(/Second delivery/);
  });

  it("billing for material that has not arrived needs a reason; billing what arrived does not", async () => {
    const { vendor, po } = await vendorAndPo(40); // 40 boxes arrived = ₹47,200 with GST
    await loginAs("accounts@dsc.demo");
    expect((await mkBill({ vendorId: vendor.id, poId: po.id, number: "A-1", amount: 47000 })).ok).toBe(true);
    const ahead = await mkBill({ vendorId: vendor.id, poId: po.id, number: "A-2", amount: 30000 });
    expect(ahead.ok).toBe(false);
    expect(ahead.ok === false && ahead.error).toMatch(/has been received/);
    expect((await mkBill({ vendorId: vendor.id, poId: po.id, number: "A-2", amount: 30000, overrideReason: "Advance billing agreed for the next lot" })).ok).toBe(true);
  });
});
