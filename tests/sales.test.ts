import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createQuotation, updateQuotation, submitQuotation, markQuotationSent, setQuotationStatus, reviseQuotation, convertQuotationToProject, createQuotationFromBoq } from "@/app/(app)/sales/quotations/actions";
import { approveRequest, rejectRequest } from "@/app/(app)/approvals/actions";
import { createBoq, saveBoqItems, submitBoq, reviseBoq, importBoqItems } from "@/app/(app)/sales/boq/actions";

beforeEach(() => logout());

const items = (rows: object[]) => JSON.stringify(rows);
const line = (description: string, quantity: number, rate: number, taxPercent = 18, category = "CARPENTRY") => ({ category, description, unit: "nos", quantity, rate, taxPercent });

async function clientId() {
  return (await db.client.findFirstOrThrow({ where: { name: "Rahul Bhatia" } })).id;
}

describe("quotations", () => {
  let qid = "";

  it("recomputes totals on the server and ignores any total sent by the browser", async () => {
    await loginAs("sales@dsc.demo");
    const r = await createQuotation(fd({
      clientId: await clientId(), title: "Retail fit-out", date: "2030-03-01", discountPct: 10,
      items: items([line("Counter", 2, 50000), line("Shelving", 10, 3000)]),
      total: 1, subtotal: 1, // tampered values must be ignored
    }));
    expect(r.ok).toBe(true);
    const q = await db.quotation.findFirstOrThrow({ where: { title: "Retail fit-out" }, include: { items: true } });
    qid = q.id;
    // subtotal 130000, 10% discount = 13000, taxable 117000, GST 18% = 21060
    expect(Number(q.subtotal)).toBe(130000);
    expect(Number(q.discountAmount)).toBe(13000);
    expect(Number(q.taxAmount)).toBe(21060);
    expect(Number(q.total)).toBe(138060);
    expect(q.items).toHaveLength(2);
    expect(q.number).toMatch(/^QT-\d{5}$/);
    expect(q.status).toBe("DRAFT");
  });

  it("rejects empty or invalid line items", async () => {
    await loginAs("sales@dsc.demo");
    expect((await createQuotation(fd({ clientId: await clientId(), date: "2030-03-01", items: items([]) }))).ok).toBe(false);
    expect((await createQuotation(fd({ clientId: await clientId(), date: "2030-03-01", items: items([line("Bad", 0, 100)]) }))).ok).toBe(false);
    expect((await createQuotation(fd({ clientId: "nope", date: "2030-03-01", items: items([line("x", 1, 1)]) }))).ok).toBe(false);
  });

  it("sales submits → needs Management; sales cannot approve; director approves", async () => {
    await loginAs("sales@dsc.demo");
    expect((await submitQuotation(qid)).ok).toBe(true);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: qid } })).status).toBe("PENDING_APPROVAL");
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: qid, status: "PENDING" } });
    expect(ap.requiredRole).toBe("MANAGEMENT");
    expect(Number(ap.amount)).toBe(138060);

    expect((await approveRequest(ap.id)).ok).toBe(false); // sales: no approvals:approve permission
    await loginAs("pm@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(false); // PM: not enough authority for quotations

    await loginAs("director@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(true);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: qid } })).status).toBe("APPROVED");
    // requester is told, project managers are told
    const salesUser = await db.user.findFirstOrThrow({ where: { email: "sales@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: salesUser.id, title: { contains: "was approved" } } })).toBeGreaterThan(0);
    const pm = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: pm.id, title: { contains: "approved" } } })).toBeGreaterThan(0);
  });

  it("an approved quotation can't be edited directly, only revised (history kept, needs re-approval)", async () => {
    await loginAs("sales@dsc.demo");
    const bad = await updateQuotation(qid, fd({ clientId: await clientId(), date: "2030-03-01", items: items([line("Sneaky", 1, 1)]) }));
    expect(bad.ok).toBe(false);

    expect((await reviseQuotation(qid, fd({ reason: "Client asked to drop shelving" }))).ok).toBe(true);
    const q = await db.quotation.findUniqueOrThrow({ where: { id: qid }, include: { revisions: true } });
    expect(q.revision).toBe(2);
    expect(q.status).toBe("DRAFT");
    expect(q.revisions).toHaveLength(1);
    expect(Number(q.revisions[0].total)).toBe(138060);

    const upd = await updateQuotation(qid, fd({ clientId: await clientId(), title: "Retail fit-out", date: "2030-03-01", items: items([line("Counter", 2, 50000)]) }));
    expect(upd.ok).toBe(true);
    const after = await db.quotation.findUniqueOrThrow({ where: { id: qid } });
    expect(Number(after.total)).toBe(118000);
    const log = await db.auditLog.findFirst({ where: { entityId: qid, summary: { contains: "from ₹1,38,060" } } });
    expect(log).toBeTruthy();
  });

  it("owner's own quotation is auto-approved within authority", async () => {
    await loginAs("owner@dsc.demo");
    await createQuotation(fd({ clientId: await clientId(), title: "Owner quote", date: "2030-03-01", items: items([line("Item", 1, 10000)]) }));
    const q = await db.quotation.findFirstOrThrow({ where: { title: "Owner quote" } });
    expect((await submitQuotation(q.id)).ok).toBe(true);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("APPROVED");
  });

  it("rejecting needs a reason and sends the quotation back to the sales rep", async () => {
    await loginAs("sales@dsc.demo");
    await createQuotation(fd({ clientId: await clientId(), title: "To reject", date: "2030-03-01", items: items([line("Item", 1, 5000)]) }));
    const q = await db.quotation.findFirstOrThrow({ where: { title: "To reject" } });
    await submitQuotation(q.id);
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: q.id, status: "PENDING" } });
    await loginAs("director@dsc.demo");
    expect((await rejectRequest(ap.id, fd({ remarks: "" }))).ok).toBe(false);
    expect((await rejectRequest(ap.id, fd({ remarks: "Margin too thin" }))).ok).toBe(true);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("REJECTED");
    // it can be edited and resubmitted
    await loginAs("sales@dsc.demo");
    expect((await updateQuotation(q.id, fd({ clientId: await clientId(), title: "To reject", date: "2030-03-01", items: items([line("Item", 1, 6000)]) }))).ok).toBe(true);
    expect((await db.quotation.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("DRAFT");
  });

  it("full lifecycle: sent → accepted (lead Won) → converted to project + BOQ, only once", async () => {
    await loginAs("sales2@dsc.demo");
    const lead = await db.lead.findFirstOrThrow({ where: { name: "Deepa Menon" } });
    await createQuotation(fd({ clientId: await clientId(), leadId: lead.id, title: "Lifecycle", date: "2030-03-01", discountPct: 5, items: items([line("Wardrobe", 3, 40000), line("Paint", 1000, 50, 18, "PAINTING")]) }));
    const q = await db.quotation.findFirstOrThrow({ where: { title: "Lifecycle" } });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("QUOTATION_SENT"); // seeded stage unchanged (already past proposal)

    expect((await markQuotationSent(q.id)).ok).toBe(false); // not approved yet
    await submitQuotation(q.id);
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: q.id, status: "PENDING" } });
    await loginAs("director@dsc.demo");
    await approveRequest(ap.id);

    await loginAs("sales2@dsc.demo");
    expect((await markQuotationSent(q.id)).ok).toBe(true);
    expect((await setQuotationStatus(q.id, "DRAFT")).ok).toBe(false); // illegal transition
    expect((await setQuotationStatus(q.id, "ACCEPTED")).ok).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("WON");

    const pmUser = await db.user.findFirstOrThrow({ where: { email: "pm@dsc.demo" } });
    // sales has no projects:create
    expect((await convertQuotationToProject(q.id, fd({ projectManagerId: pmUser.id }))).ok).toBe(false);
    await loginAs("director@dsc.demo");
    expect((await convertQuotationToProject(q.id, fd({ projectManagerId: "" }))).ok).toBe(false);
    const r = await convertQuotationToProject(q.id, fd({ projectManagerId: pmUser.id, startDate: "2030-04-01" }));
    expect(r.ok).toBe(true);

    const qq = await db.quotation.findUniqueOrThrow({ where: { id: q.id } });
    const project = await db.project.findUniqueOrThrow({ where: { id: qq.projectId! } });
    // subtotal 120000 + 50000 = 170000, 5% disc = 8500 → contract value excl. GST 161500
    expect(Number(project.contractValue)).toBe(161500);
    expect(project.projectManagerId).toBe(pmUser.id);
    expect(project.code).toMatch(/^PRJ-\d{5}$/);
    const boq = await db.boq.findUniqueOrThrow({ where: { id: qq.boqId! }, include: { items: true } });
    expect(boq.items).toHaveLength(2);
    expect(boq.projectId).toBe(project.id);
    expect(boq.items.every((i) => Number(i.materialCost) === 0)).toBe(true);
    expect(await db.notification.count({ where: { userId: pmUser.id, title: { contains: project.name } } })).toBe(1);

    expect((await convertQuotationToProject(q.id, fd({ projectManagerId: pmUser.id }))).ok).toBe(false); // only once
    expect((await reviseQuotation(q.id)).ok).toBe(false); // can't revise once a project exists
  });
});

describe("BOQ", () => {
  let boqId = "";
  const rows = [
    { category: "CARPENTRY", item: "Kitchen base unit", unit: "rft", quantity: 10, materialCost: 3000, labourCost: 800, otherCost: 200, sellingRate: 6000 },
    { category: "PAINTING", item: "Wall paint", unit: "sqft", quantity: 1000, materialCost: 12, labourCost: 8, otherCost: 0, sellingRate: 30 },
  ];

  it("saves items with correct per-item cost, total and overall margin", async () => {
    await loginAs("pm@dsc.demo");
    expect((await createBoq(fd({ title: "Test BOQ" }))).ok).toBe(true);
    const b = await db.boq.findFirstOrThrow({ where: { title: "Test BOQ" } });
    boqId = b.id;
    expect((await saveBoqItems(boqId, JSON.stringify(rows))).ok).toBe(true);
    const items = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    expect(Number(items[0].estimatedCost)).toBe(40000); // 10 × 4000
    expect(Number(items[0].total)).toBe(60000);
    expect(Number(items[1].estimatedCost)).toBe(20000);
    expect(Number(items[1].total)).toBe(30000);
  });

  it("users without cost access can edit quantities/rates but existing costs are preserved", async () => {
    await loginAs("designer@dsc.demo");
    const existing = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    const payload = existing.map((i, idx) => ({
      id: i.id, category: i.category, item: i.item, unit: i.unit, quantity: idx === 0 ? 20 : Number(i.quantity),
      materialCost: 1, labourCost: 1, otherCost: 1, // attempted tampering with hidden columns
      sellingRate: Number(i.sellingRate),
    }));
    payload.push({ id: undefined as never, category: "OTHER", item: "New item", unit: "nos", quantity: 1, materialCost: 999, labourCost: 0, otherCost: 0, sellingRate: 500 });
    expect((await saveBoqItems(boqId, JSON.stringify(payload))).ok).toBe(true);
    const after = await db.boqItem.findMany({ where: { boqId }, orderBy: { sortOrder: "asc" } });
    expect(Number(after[0].quantity)).toBe(20);
    expect(Number(after[0].materialCost)).toBe(3000); // preserved
    expect(Number(after[0].estimatedCost)).toBe(80000);
    expect(Number(after[2].materialCost)).toBe(0); // new row: cost cannot be set by a user without access
  });

  it("validates rows and blocks other tenants' / missing BOQs", async () => {
    await loginAs("pm@dsc.demo");
    expect((await saveBoqItems(boqId, JSON.stringify([{ item: "", quantity: 1 }]))).ok).toBe(false);
    expect((await saveBoqItems(boqId, "not json")).ok).toBe(false);
    expect((await saveBoqItems("missing", "[]")).ok).toBe(false);
  });

  it("imports items from an Excel file, stops on bad rows", async () => {
    await loginAs("pm@dsc.demo");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("BOQ");
    ws.addRow(["Category", "Item", "Unit", "Quantity", "Material Cost", "Labour Cost", "Other Cost", "Selling Rate"]);
    ws.addRow(["flooring", "Vitrified tiles", "sqft", 800, 70, 25, 5, 150]);
    ws.addRow(["Electrical", "Points", "nos", "1,200", 400, 200, 0, 900]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const f = new FormData();
    f.set("file", new File([buf], "boq.xlsx"));
    const before = await db.boqItem.count({ where: { boqId } });
    const r = await importBoqItems(boqId, f);
    expect(r.ok).toBe(true);
    expect(await db.boqItem.count({ where: { boqId } })).toBe(before + 2);
    const tiles = await db.boqItem.findFirstOrThrow({ where: { boqId, item: "Vitrified tiles" } });
    expect(tiles.category).toBe("FLOORING");
    expect(Number(tiles.total)).toBe(120000);
    const pts = await db.boqItem.findFirstOrThrow({ where: { boqId, item: "Points" } });
    expect(Number(pts.quantity)).toBe(1200); // thousands separator handled

    const bad = new ExcelJS.Workbook();
    bad.addWorksheet("x").addRow(["foo", "bar"]);
    const f2 = new FormData();
    f2.set("file", new File([Buffer.from(await bad.xlsx.writeBuffer())], "bad.xlsx"));
    expect((await importBoqItems(boqId, f2)).ok).toBe(false);
    const f3 = new FormData();
    f3.set("file", new File(["hello"], "notes.txt"));
    expect((await importBoqItems(boqId, f3)).ok).toBe(false);
  });

  it("approval locks the BOQ; revision creates -R2 and marks the old one Revised", async () => {
    await loginAs("pm@dsc.demo");
    expect((await submitBoq(boqId)).ok).toBe(true);
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: boqId, status: "PENDING" } });
    await loginAs("director@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(true);
    expect((await db.boq.findUniqueOrThrow({ where: { id: boqId } })).status).toBe("APPROVED");

    await loginAs("pm@dsc.demo");
    expect((await saveBoqItems(boqId, "[]")).ok).toBe(false); // locked
    const r = await reviseBoq(boqId);
    expect(r.ok).toBe(true);
    const old = await db.boq.findUniqueOrThrow({ where: { id: boqId } });
    expect(old.status).toBe("REVISED");
    const rev = await db.boq.findFirstOrThrow({ where: { number: old.number + "-R2" }, include: { items: true } });
    expect(rev.revision).toBe(2);
    expect(rev.status).toBe("DRAFT");
    expect(rev.items.length).toBeGreaterThan(0);
    expect((await reviseBoq(boqId)).ok).toBe(false); // old one can't be revised again
  });

  it("creates a quotation from a BOQ using selling rates only", async () => {
    await loginAs("sales@dsc.demo");
    const boq = await db.boq.findFirstOrThrow({ where: { title: "Test BOQ", status: "REVISED" } });
    const r = await createQuotationFromBoq(boq.id, fd({ clientId: await clientId() }));
    expect(r.ok).toBe(true);
    const q = await db.quotation.findFirstOrThrow({ where: { boqId: boq.id }, include: { items: true } });
    expect(q.items.length).toBe(await db.boqItem.count({ where: { boqId: boq.id } }));
    expect(q.items.some((i) => i.description.includes("Kitchen base unit"))).toBe(true);
    expect(Number(q.total)).toBeGreaterThan(0);
  });
});
