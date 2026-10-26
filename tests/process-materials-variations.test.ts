import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { calendarDay } from "@/lib/utils";
import { deliveryLines, riskOf, syncDeliveryRisks } from "@/lib/delivery-risk";
import { updateDeliveryLine } from "@/app/(app)/procurement/delivery-actions";
import { recordWaste } from "@/app/(app)/inventory/waste/actions";
import { reconcileProject } from "@/lib/waste";
import { approveExtraWorkInternally, completeExtraWork, createExtraWork, linkExtraWorkInvoice, recordClientDecision, sendExtraWork, startExtraWork, verifyExtraWork } from "@/app/(app)/extra-work/actions";

beforeEach(() => logout());

const DAY = 86400000;
const iso = (d: number) => new Date(calendarDay().getTime() + d * DAY).toISOString().slice(0, 10);
const day = (d: number) => new Date(calendarDay().getTime() + d * DAY);

async function basics() {
  const company = await db.company.findFirstOrThrow();
  const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
  const proc = await db.user.findFirstOrThrow({ where: { email: "procurement@dsc.demo" } });
  const sup = await db.user.findFirstOrThrow({ where: { email: "supervisor@dsc.demo" } });
  const client = await db.client.findFirstOrThrow({ where: { deletedAt: null } });
  const vendor = await db.vendor.findFirstOrThrow({ where: { deletedAt: null } });
  const project = await db.project.create({ data: { companyId: company.id, code: `PRJ-M${Math.floor(Math.random() * 1e6)}`, name: "Materials test site", clientId: client.id, status: "EXECUTION", projectManagerId: pm.id, supervisorId: sup.id, contractValue: 500000, members: { create: [{ userId: pm.id, roleLabel: "PM" }, { userId: sup.id, roleLabel: "Supervisor" }] } } });
  return { company, pm, proc, sup, client, vendor, project };
}

describe("late deliveries", () => {
  it("is late when the promise has passed, too late when the promise is after the need-by day", () => {
    const today = day(0);
    expect(riskOf(day(5), day(-2), today)).toEqual({ status: "LATE", daysLate: 2 });
    expect(riskOf(day(3), day(7), today)).toEqual({ status: "AT_RISK", daysLate: 4 });
    expect(riskOf(day(7), day(3), today).status).toBe("OK");
    expect(riskOf(null, null, today).status).toBe("OK");
  });

  it("a late line raises one action for procurement, needs a reason and a plan, and closes when it arrives", async () => {
    const { company, proc, project, vendor } = await basics();
    const po = await db.purchaseOrder.create({
      data: { companyId: company.id, number: `PO-D${Math.floor(Math.random() * 1e6)}`, vendorId: vendor.id, projectId: project.id, status: "SENT_TO_VENDOR", deliveryDate: day(-3), createdById: proc.id, items: { create: [{ description: "18mm plywood", unit: "nos", quantity: 100, receivedQty: 20, rate: 1500, amount: 150000 }] } },
      include: { items: true },
    });
    const line = po.items[0];
    const lines = await deliveryLines(company.id, [project.id], day(0));
    expect(lines.find((l) => l.itemId === line.id)).toMatchObject({ status: "LATE", daysLate: 3, outstanding: 80 });

    await syncDeliveryRisks(company.id);
    await syncDeliveryRisks(company.id);
    const acts = await db.actionItem.findMany({ where: { sourceType: "PurchaseOrderItem", sourceId: line.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ status: "OPEN", severity: "HIGH", ownerId: proc.id, projectId: project.id });
    expect(await db.notification.count({ where: { userId: project.projectManagerId!, dedupeKey: `delivery:${line.id}:late` } })).toBe(1);

    await loginAs("procurement@dsc.demo");
    expect((await updateDeliveryLine(line.id, fd({ promisedEta: iso(-1) }))).ok).toBe(false); // still late and no reason
    expect((await updateDeliveryLine(line.id, fd({ promisedEta: iso(-1), delayReason: "SUPPLIER_DELAY" }))).ok).toBe(false); // no plan
    expect((await updateDeliveryLine(line.id, fd({ promisedEta: iso(-1), delayReason: "SUPPLIER_DELAY", recoveryNote: "Part delivery of 40 tomorrow, rest from Vendor B" }))).ok).toBe(true);
    expect(await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({ delayReason: "SUPPLIER_DELAY", recoveryNote: "Part delivery of 40 tomorrow, rest from Vendor B" });
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: acts[0].id } })).status).toBe("OPEN"); // still late: stays open

    // a new promise that the site can live with fixes it
    expect((await updateDeliveryLine(line.id, fd({ promisedEta: iso(2), needBy: iso(4) }))).ok).toBe(true);
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: acts[0].id } })).status).toBe("RESOLVED");
    // and a promise after the day the site needs it is "too late"
    expect((await updateDeliveryLine(line.id, fd({ promisedEta: iso(6), needBy: iso(4) }))).ok).toBe(false);
    expect((await updateDeliveryLine(line.id, fd({ promisedEta: iso(6), needBy: iso(4), delayReason: "TRANSPORT", recoveryNote: "Book a tempo for the first 20" }))).ok).toBe(true);
    expect(await db.actionItem.count({ where: { sourceType: "PurchaseOrderItem", sourceId: line.id, status: "OPEN" } })).toBe(1);
    // once everything is received the action closes
    await db.purchaseOrderItem.update({ where: { id: line.id }, data: { receivedQty: 100 } });
    await syncDeliveryRisks(company.id);
    expect(await db.actionItem.count({ where: { sourceType: "PurchaseOrderItem", sourceId: line.id, status: "OPEN" } })).toBe(0);
  });

  it("people who do not manage orders cannot change delivery dates", async () => {
    const { company, proc, project, vendor } = await basics();
    const po = await db.purchaseOrder.create({ data: { companyId: company.id, number: `PO-E${Math.floor(Math.random() * 1e6)}`, vendorId: vendor.id, projectId: project.id, status: "SENT_TO_VENDOR", createdById: proc.id, items: { create: [{ description: "Laminate", unit: "nos", quantity: 10, rate: 100, amount: 1000 }] } }, include: { items: true } });
    await loginAs("supervisor@dsc.demo");
    expect((await updateDeliveryLine(po.items[0].id, fd({ promisedEta: iso(3) }))).ok).toBe(false);
  });
});

describe("waste, damage, offcuts and reconciliation", () => {
  let projectId = "";
  let materialId = "";
  let siteId = "";

  it("waste leaves the site stock, needs a reason and an owner, and raises one action; an offcut stays in stock", async () => {
    const { company, project, pm } = await basics();
    projectId = project.id;
    const mat = await db.material.findFirstOrThrow({ where: { deletedAt: null, unit: { not: "" } } });
    materialId = mat.id;
    const site = await db.warehouse.create({ data: { companyId: company.id, name: `Site ${project.code}`, type: "SITE", projectId: project.id } });
    siteId = site.id;
    await db.stockBalance.create({ data: { companyId: company.id, materialId, locationId: siteId, quantity: 100, avgCost: 50 } });
    await db.materialIssue.create({ data: { companyId: company.id, number: `MI-W${Math.floor(Math.random() * 1e6)}`, projectId, fromLocationId: siteId, toLocationId: siteId, purpose: "Test issue", items: { create: [{ materialId, quantity: 100, unitCost: 50 }] } } });

    await loginAs("store@dsc.demo");
    const base = { materialId, projectId, kind: "WASTE", quantity: 12, date: iso(0) };
    expect((await recordWaste(fd({ ...base, reason: "" }))).ok).toBe(false);
    expect((await recordWaste(fd({ ...base, reason: "Cut wrongly" }))).ok).toBe(false); // nobody to find out why
    expect((await recordWaste(fd({ ...base, quantity: 500, reason: "Cut wrongly", ownerId: pm.id }))).ok).toBe(false); // more than there is: stock never goes negative
    expect((await recordWaste(fd({ ...base, date: iso(3), reason: "Cut wrongly", ownerId: pm.id }))).ok).toBe(false); // future day
    const r = await recordWaste(fd({ ...base, reason: "Cut wrongly: drawing misread", ownerId: pm.id, actionNote: "Re-brief the carpenters" }));
    expect(r.ok).toBe(true);
    expect(Number((await db.stockBalance.findUniqueOrThrow({ where: { materialId_locationId: { materialId, locationId: siteId } } })).quantity)).toBe(88);
    const w = await db.materialWaste.findFirstOrThrow({ where: { projectId, materialId } });
    expect(Number(w.costValue)).toBe(600); // 12 x average cost 50
    expect(await db.actionItem.count({ where: { sourceType: "MaterialWaste", sourceId: w.id, ownerId: pm.id } })).toBe(1);

    // a reusable offcut is recorded but is not waste and leaves nothing out of stock
    expect((await recordWaste(fd({ ...base, kind: "OFFCUT_REUSABLE", quantity: 5, reason: "Offcut from the wardrobe back panels" }))).ok).toBe(true);
    expect(Number((await db.stockBalance.findUniqueOrThrow({ where: { materialId_locationId: { materialId, locationId: siteId } } })).quantity)).toBe(88);
  });

  it("reconciliation balances: issued − returned − waste − still at site = used", async () => {
    const { company } = { company: await db.company.findFirstOrThrow() };
    const rows = await reconcileProject(company.id, projectId);
    const r = rows.find((x) => x.materialId === materialId)!;
    expect(r).toMatchObject({ issued: 100, returned: 0, waste: 12, atSite: 88, offcuts: 5, used: 0 });
    expect(r.wasteValue).toBe(600);
  });

  it("people who may not touch stock cannot record waste", async () => {
    await loginAs("accounts@dsc.demo");
    expect((await recordWaste(fd({ materialId, projectId, kind: "WASTE", quantity: 1, reason: "x", ownerId: "x", date: iso(0) }))).ok).toBe(false);
  });
});

describe("extra work: what kind is it, who approves, what is billed", () => {
  it("work already in the contract, or DSC's own mistake, can never carry a price", async () => {
    const { project } = await basics();
    await loginAs("supervisor@dsc.demo");
    expect((await createExtraWork(fd({ projectId: project.id, title: "Fix wrongly cut shutter", kind: "OWN_REWORK", amount: 5000, scopeNote: "Cut to the wrong size" }))).ok).toBe(false);
    expect((await createExtraWork(fd({ projectId: project.id, title: "Fix wrongly cut shutter", kind: "OWN_REWORK", amount: 0 }))).ok).toBe(false); // needs the reason
    expect((await createExtraWork(fd({ projectId: project.id, title: "Fix wrongly cut shutter", kind: "OWN_REWORK", amount: 0, scopeNote: "Cut to the wrong size", costEstimate: 3000 }))).ok).toBe(true);
    expect((await createExtraWork(fd({ projectId: project.id, title: "Item 4 of the BOQ", kind: "INCLUDED", amount: 2000 }))).ok).toBe(false);
    expect((await createExtraWork(fd({ projectId: project.id, title: "Add 5 cabinets", kind: "CHARGEABLE", inOriginalScope: "YES", amount: 50000 }))).ok).toBe(false); // you just said it is in the contract
    const own = await db.additionalWork.findFirstOrThrow({ where: { projectId: project.id, kind: "OWN_REWORK" } });
    expect(Number(own.costEstimate)).toBe(3000);
    // own rework needs no client and no director: it can start, finish and be checked, but is never sent or billed
    await loginAs("pm@dsc.demo");
    expect((await sendExtraWork(own.id)).ok).toBe(false);
    expect((await recordClientDecision(own.id, true, fd({ decidedByName: "X" }))).ok).toBe(false);
    expect((await startExtraWork(own.id)).ok).toBe(true);
    expect((await completeExtraWork(own.id)).ok).toBe(true);
    expect((await verifyExtraWork(own.id, fd({ note: "" }))).ok).toBe(false);
    expect((await verifyExtraWork(own.id, fd({ note: "Re-cut shutters measured and fitted" }))).ok).toBe(true);
    await loginAs("accounts@dsc.demo");
    expect((await linkExtraWorkInvoice(own.id, fd({ invoiceId: "x" }))).ok).toBe(false);
  });

  it("an emergency needs a director before it starts, someone else approving, and then chases the client's written approval", async () => {
    const { project, pm } = await basics();
    await loginAs("pm@dsc.demo");
    const r = await createExtraWork(fd({ projectId: project.id, title: "Leaking pipe: seal the false ceiling", kind: "EMERGENCY", amount: 18000, costEstimate: 9000, scopeNote: "Water damage risk to the finished ceiling" }));
    expect(r.ok).toBe(true);
    const w = await db.additionalWork.findFirstOrThrow({ where: { projectId: project.id, kind: "EMERGENCY" } });
    expect((await startExtraWork(w.id)).ok).toBe(false); // no director yet
    expect((await approveExtraWorkInternally(w.id, fd({ note: "ok" }))).ok).toBe(false); // a PM cannot approve
    await loginAs("director@dsc.demo");
    expect((await approveExtraWorkInternally(w.id, fd({ note: "" }))).ok).toBe(false);
    expect((await approveExtraWorkInternally(w.id, fd({ note: "Protects the finished ceiling; client unreachable on Sunday" }))).ok).toBe(true);
    await loginAs("pm@dsc.demo");
    expect((await startExtraWork(w.id)).ok).toBe(true);
    const chase = await db.actionItem.findFirstOrThrow({ where: { sourceType: "AdditionalWork", sourceId: w.id } });
    expect(chase).toMatchObject({ status: "OPEN", ownerId: pm.id });
    expect((await completeExtraWork(w.id)).ok).toBe(true);
    // billing is blocked until the client's written approval is on record
    const inv = await db.invoice.create({ data: { companyId: project.companyId, number: `INV-X${Math.floor(Math.random() * 1e6)}`, clientId: project.clientId, projectId: project.id } });
    await loginAs("accounts@dsc.demo");
    expect((await linkExtraWorkInvoice(w.id, fd({ invoiceId: inv.id }))).ok).toBe(false);
    await loginAs("pm@dsc.demo");
    const proof = new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10])], "approval.pdf", { type: "application/pdf" });
    const f = fd({ decidedByName: "Neha, Frido" });
    f.set("proof", proof);
    expect((await recordClientDecision(w.id, true, f)).ok).toBe(true);
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: chase.id } })).status).toBe("RESOLVED");
    expect((await db.additionalWork.findUniqueOrThrow({ where: { id: w.id } })).status).toBe("COMPLETED"); // an after-the-fact approval does not rewind the work
    await loginAs("accounts@dsc.demo");
    expect((await linkExtraWorkInvoice(w.id, fd({ invoiceId: inv.id }))).ok).toBe(true);
    expect((await db.additionalWork.findUniqueOrThrow({ where: { id: w.id } })).billedInvoiceId).toBe(inv.id);
  });

  it("a concession records its value and needs a director; it is never sent to the client", async () => {
    const { project } = await basics();
    await loginAs("pm@dsc.demo");
    expect((await createExtraWork(fd({ projectId: project.id, title: "Free shoe rack for a good client", kind: "CONCESSION", amount: 0, scopeNote: "Goodwill" }))).ok).toBe(false); // value must be on record
    expect((await createExtraWork(fd({ projectId: project.id, title: "Free shoe rack for a good client", kind: "CONCESSION", amount: 12000, costEstimate: 7000, scopeNote: "Goodwill: repeat client" }))).ok).toBe(true);
    const w = await db.additionalWork.findFirstOrThrow({ where: { projectId: project.id, kind: "CONCESSION" } });
    expect((await sendExtraWork(w.id)).ok).toBe(false);
    expect((await startExtraWork(w.id)).ok).toBe(false);
    await loginAs("owner@dsc.demo");
    expect((await approveExtraWorkInternally(w.id, fd({ note: "Goodwill, repeat client; value 12,000 given free" }))).ok).toBe(true);
    await loginAs("pm@dsc.demo");
    expect((await startExtraWork(w.id)).ok).toBe(true);
  });
});
