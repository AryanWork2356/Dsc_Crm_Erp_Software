import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createPurchaseRequest, submitPurchaseRequest } from "@/app/(app)/procurement/actions";
import { createReceipt, createIssue } from "@/app/(app)/inventory/actions";
import { createTransfer, decideTransfer } from "@/app/(app)/transfers/actions";
import { daysNotice, isShortNotice } from "@/lib/material-notice";
import { projectFinancials } from "@/lib/project-finance";

beforeEach(() => logout());

const proj = (code: string) => db.project.findFirstOrThrow({ where: { code } });
const json = (x: unknown) => JSON.stringify(x);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])], "challan.jpg", { type: "image/jpeg" });

describe("material notice rule", () => {
  it("counts calendar days in India time", () => {
    expect(daysNotice("2026-03-05", new Date("2026-03-03T10:00:00Z"))).toBe(2);
    expect(daysNotice("2026-03-03", new Date("2026-03-03T10:00:00Z"))).toBe(0);
    expect(daysNotice("2026-03-02", new Date("2026-03-03T10:00:00Z"))).toBe(-1);
    // 20:00 UTC on the 3rd is already the 4th in India
    expect(daysNotice("2026-03-05", new Date("2026-03-03T20:00:00Z"))).toBe(1);
    expect(isShortNotice("2026-03-04", 2, new Date("2026-03-03T10:00:00Z"))).toBe(true);
    expect(isShortNotice("2026-03-05", 2, new Date("2026-03-03T10:00:00Z"))).toBe(false);
    expect(isShortNotice(null, 2)).toBe(false);
  });

  it("a request needed tomorrow can only be submitted with a reason, and is flagged to the PM and procurement", async () => {
    const p = await proj("PRJ-00001");
    await loginAs("engineer@dsc.demo");
    const make = async (requiredDate: string, reason?: string) => {
      const r = await createPurchaseRequest(fd({ projectId: p.id, requiredDate, reason, priority: "LOW", items: json([{ description: "Fevicol 5kg", unit: "nos", quantity: 4 }]) }));
      expect(r.ok).toBe(true);
      return (r as { data: { id: string } }).data.id;
    };
    const late = await make(plusDays(1));
    const refused = await submitPurchaseRequest(late);
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toMatch(/at least 2 days/);
    expect((await db.purchaseRequest.findUniqueOrThrow({ where: { id: late } })).shortNotice).toBe(true);

    const withReason = await make(plusDays(1), "Client asked for extra shelves today");
    const pm = await db.user.findFirstOrThrow({ where: { id: p.projectManagerId! } });
    const before = await db.notification.count({ where: { userId: pm.id, title: { contains: "Short-notice" } } });
    expect((await submitPurchaseRequest(withReason)).ok).toBe(true);
    const row = await db.purchaseRequest.findUniqueOrThrow({ where: { id: withReason } });
    expect(row.shortNotice).toBe(true);
    expect(row.priority).toBe("HIGH"); // LOW is raised
    expect(await db.notification.count({ where: { userId: pm.id, title: { contains: "Short-notice" } } })).toBe(before + 1);

    const planned = await make(plusDays(6));
    expect((await submitPurchaseRequest(planned)).ok).toBe(true);
    expect((await db.purchaseRequest.findUniqueOrThrow({ where: { id: planned } })).shortNotice).toBe(false);
  });
});

describe("delivery challan photo", () => {
  it("is saved with the delivery, attached to the purchase order", async () => {
    const vendor = await db.vendor.findFirstOrThrow({});
    const wh = await db.warehouse.findFirstOrThrow({ where: { type: "WAREHOUSE" } });
    const p = await proj("PRJ-00001");
    const po = await db.purchaseOrder.create({ data: { companyId: p.companyId, number: "PO-CHALLAN-1", vendorId: vendor.id, projectId: p.id, status: "SENT_TO_VENDOR", items: { create: [{ description: "Test fixtures", unit: "nos", quantity: 10, rate: 100, taxPercent: 18, amount: 1000 }] } }, include: { items: true } });
    await loginAs("store@dsc.demo");
    const bad = fd({ poId: po.id, locationId: wh.id, deliveryDate: "2030-02-01", items: json([{ poItemId: po.items[0].id, receivedQty: 4 }]) });
    bad.append("challanPhoto", new File([new Uint8Array([1, 2, 3, 4])], "x.jpg", { type: "image/jpeg" }));
    expect((await createReceipt(bad)).ok).toBe(false); // not really a JPEG

    const f = fd({ poId: po.id, locationId: wh.id, deliveryDate: "2030-02-01", challanNo: "CH-9", items: json([{ poItemId: po.items[0].id, receivedQty: 4 }]) });
    f.append("challanPhoto", jpeg());
    expect((await createReceipt(f)).ok).toBe(true);
    const rec = await db.materialReceipt.findFirstOrThrow({ where: { poId: po.id } });
    expect(rec.challanDocId).toBeTruthy();
    const doc = await db.document.findUniqueOrThrow({ where: { id: rec.challanDocId! } });
    expect(doc).toMatchObject({ entityType: "PO", entityId: po.id, type: "PURCHASE", mimeType: "image/jpeg" });

    // a delivery without a photo still works
    expect((await createReceipt(fd({ poId: po.id, locationId: wh.id, deliveryDate: "2030-02-02", items: json([{ poItemId: po.items[0].id, receivedQty: 2 }]) }))).ok).toBe(true);
  });
});

describe("transfers between projects", () => {
  let materialId = "";
  let A = "";
  let B = "";

  it("set-up: two projects of our own, a material of our own, issued to site A", async () => {
    const wh = await db.warehouse.findFirstOrThrow({ where: { name: "Thane Main Warehouse" } });
    const company = await db.company.findFirstOrThrow();
    const client = await db.client.findFirstOrThrow({ where: { companyId: company.id } });
    const [pm, pm2, sup, eng] = await Promise.all(["pm@dsc.demo", "pm2@dsc.demo", "supervisor@dsc.demo", "engineer@dsc.demo"].map((email) => db.user.findFirstOrThrow({ where: { email } })));
    const mk = (code: string, pmId: string) => db.project.create({ data: { companyId: company.id, code, name: `Transfer test ${code}`, clientId: client.id, status: "EXECUTION", projectManagerId: pmId, supervisorId: sup.id, siteEngineerId: eng.id } });
    A = (await mk("PRJ-TR-A", pm.id)).id;
    B = (await mk("PRJ-TR-B", pm2.id)).id;
    const m = await db.material.create({ data: { companyId: company.id, sku: "TR-PANEL-1", name: "Transfer test panel", unit: "nos", purchaseCost: 1250 } });
    materialId = m.id;
    await db.stockBalance.create({ data: { companyId: company.id, materialId, locationId: wh.id, quantity: 50, avgCost: 1250 } });
    const p1 = { id: A };
    await loginAs("store@dsc.demo");
    expect((await createIssue(fd({ projectId: p1.id, fromLocationId: wh.id, items: json([{ materialId, quantity: 10 }]) }))).ok).toBe(true);
  });

  it("a supervisor's material transfer waits for the first project's PM, then moves stock and cost", async () => {
    const p1 = { id: A, companyId: (await db.project.findUniqueOrThrow({ where: { id: A } })).companyId };
    const p2 = { id: B };
    const fin1 = (await projectFinancials(p1.companyId, [p1.id, p2.id])).get(p1.id)!;
    const fin2 = (await projectFinancials(p1.companyId, [p1.id, p2.id])).get(p2.id)!;

    await loginAs("supervisor@dsc.demo");
    // more than is on site is refused
    expect((await createTransfer(fd({ kind: "MATERIAL", fromProjectId: p1.id, toProjectId: p2.id, items: json([{ materialId, quantity: 999 }]) }))).ok).toBe(false);
    const r = await createTransfer(fd({ kind: "MATERIAL", fromProjectId: p1.id, toProjectId: p2.id, reason: "Same panels needed at the mall", items: json([{ materialId, quantity: 4 }]) }));
    expect(r.ok).toBe(true);
    const id = (r as { data: { id: string } }).data.id;
    expect((await db.transferRequest.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    // nothing has moved yet
    expect((await projectFinancials(p1.companyId, [p1.id])).get(p1.id)!.actualCost).toBeCloseTo(fin1.actualCost, 2);

    // the requester can't approve; PM of the other project can't either
    expect((await decideTransfer(id, true)).ok).toBe(false);
    await loginAs("pm2@dsc.demo");
    expect((await decideTransfer(id, true)).ok).toBe(false);

    await loginAs("pm@dsc.demo"); // PM of the first project
    expect((await decideTransfer(id, false)).ok).toBe(false); // rejecting needs a reason
    const ok = await decideTransfer(id, true);
    expect(ok.ok).toBe(true);
    expect((await db.transferRequest.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
    expect((await decideTransfer(id, true)).ok).toBe(false); // already decided

    const after = await projectFinancials(p1.companyId, [p1.id, p2.id]);
    const moved = after.get(p2.id)!.actualCost - fin2.actualCost;
    expect(moved).toBeGreaterThan(0);
    expect(fin1.actualCost - after.get(p1.id)!.actualCost).toBeCloseTo(moved, 2); // cost left project 1 and landed on project 2
    const txn = await db.inventoryTransaction.findFirstOrThrow({ where: { refType: "TRANSFER", refId: id } });
    expect(txn.type).toBe("TRANSFER");
    expect(Number(txn.quantity)).toBe(4);
    const acc = await db.user.findFirstOrThrow({ where: { email: "accounts@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: acc.id, title: { contains: "transferred between projects" } } })).toBeGreaterThan(0);
  });

  it("the PM raising a transfer approves it immediately; a rejected one moves nothing", async () => {
    const p1 = { id: A, companyId: (await db.project.findUniqueOrThrow({ where: { id: A } })).companyId };
    const p2 = { id: B };
    await loginAs("pm@dsc.demo");
    const auto = await createTransfer(fd({ kind: "MATERIAL", fromProjectId: p1.id, toProjectId: p2.id, items: json([{ materialId, quantity: 1 }]) }));
    expect(auto.ok).toBe(true);
    expect((await db.transferRequest.findUniqueOrThrow({ where: { id: (auto as { data: { id: string } }).data.id } })).status).toBe("APPROVED");

    await loginAs("engineer@dsc.demo");
    const pending = await createTransfer(fd({ kind: "MATERIAL", fromProjectId: p1.id, toProjectId: p2.id, items: json([{ materialId, quantity: 2 }]) }));
    const id = (pending as { data: { id: string } }).data.id;
    const site = await db.warehouse.findFirstOrThrow({ where: { projectId: p1.id, type: "SITE" } });
    const before = Number((await db.stockBalance.findUniqueOrThrow({ where: { materialId_locationId: { materialId, locationId: site.id } } })).quantity);
    await loginAs("director@dsc.demo"); // Management may decide any transfer
    expect((await decideTransfer(id, false, fd({ note: "Needed here this week" }))).ok).toBe(true);
    expect((await db.transferRequest.findUniqueOrThrow({ where: { id } })).status).toBe("REJECTED");
    expect(Number((await db.stockBalance.findUniqueOrThrow({ where: { materialId_locationId: { materialId, locationId: site.id } } })).quantity)).toBe(before);
  });

  it("moves workers only when they are on the first project, and needs the PM's approval", async () => {
    const p1 = { id: A, companyId: (await db.project.findUniqueOrThrow({ where: { id: A } })).companyId };
    const p2 = { id: B };
    const w = await db.worker.create({ data: { companyId: p1.companyId, code: "W-TR-1", name: "Transfer Test Worker", trade: "HELPER", dailyWage: 600, currentProjectId: p1.id } });
    const elsewhere = await db.worker.create({ data: { companyId: p1.companyId, code: "W-TR-2", name: "Elsewhere Worker", trade: "HELPER", dailyWage: 600, currentProjectId: p2.id } });
    await loginAs("supervisor@dsc.demo");
    expect((await createTransfer(fd({ kind: "MANPOWER", fromProjectId: p1.id, toProjectId: p2.id, items: json([{ workerId: elsewhere.id }]) }))).ok).toBe(false);
    const r = await createTransfer(fd({ kind: "MANPOWER", fromProjectId: p1.id, toProjectId: p2.id, emergency: "on", items: json([{ workerId: w.id }]) }));
    expect(r.ok).toBe(true);
    const id = (r as { data: { id: string } }).data.id;
    expect((await db.worker.findUniqueOrThrow({ where: { id: w.id } })).currentProjectId).toBe(p1.id); // not yet
    await loginAs("pm@dsc.demo");
    expect((await decideTransfer(id, true)).ok).toBe(true);
    expect((await db.worker.findUniqueOrThrow({ where: { id: w.id } })).currentProjectId).toBe(p2.id);
    const t = await db.transferRequest.findUniqueOrThrow({ where: { id } });
    expect(t.emergency).toBe(true);
  });

  it("is not available to sales, accounts can only look, and a project can't transfer to itself", async () => {
    const p1 = { id: A, companyId: (await db.project.findUniqueOrThrow({ where: { id: A } })).companyId };
    await loginAs("sales@dsc.demo");
    expect((await createTransfer(fd({ kind: "MATERIAL", fromProjectId: p1.id, toProjectId: p1.id, items: json([{ materialId, quantity: 1 }]) }))).ok).toBe(false);
    await loginAs("accounts@dsc.demo");
    expect((await createTransfer(fd({ kind: "MATERIAL", fromProjectId: p1.id, toProjectId: p1.id, items: json([{ materialId, quantity: 1 }]) }))).ok).toBe(false);
    await loginAs("pm@dsc.demo");
    expect((await createTransfer(fd({ kind: "MATERIAL", fromProjectId: p1.id, toProjectId: p1.id, items: json([{ materialId, quantity: 1 }]) }))).ok).toBe(false);
  });
});
