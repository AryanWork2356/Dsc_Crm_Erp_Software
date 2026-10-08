import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { loginAs, logout, fd } from "./setup";
import { createPurchaseRequest, submitPurchaseRequest, createPurchaseOrder, updatePurchaseOrder, submitPurchaseOrder, sendPurchaseOrder, cancelPurchaseOrder, createVendor, createMaterial } from "@/app/(app)/procurement/actions";
import { approveRequest } from "@/app/(app)/approvals/actions";
import { createReceipt, createIssue, createReturn, recordMovement } from "@/app/(app)/inventory/actions";
import { projectFinancials } from "@/lib/project-finance";
import { projectMaterialPlan } from "@/lib/project-materials";

beforeEach(() => logout());

const mat = (name: string) => db.material.findFirstOrThrow({ where: { name: { startsWith: name } } });
const wh = () => db.warehouse.findFirstOrThrow({ where: { name: "Thane Main Warehouse" } });
const stockAt = async (materialId: string, locationId: string) => Number((await db.stockBalance.findUnique({ where: { materialId_locationId: { materialId, locationId } } }))?.quantity ?? 0);
const items = (rows: object[]) => JSON.stringify(rows);

describe("vendors & materials", () => {
  it("rejects a duplicate GSTIN and validates the format", async () => {
    await loginAs("procurement@dsc.demo");
    expect((await createVendor(fd({ name: "Bad", gstin: "123" }))).ok).toBe(false);
    expect((await createVendor(fd({ name: "Dup", gstin: "27AAACG1234F1Z5" }))).ok).toBe(false); // Greenply's
    expect((await createVendor(fd({ name: "Fresh Vendor", gstin: "27AABCF5555K1Z3", phone: "+91 98000 12345" }))).ok).toBe(true);
    expect((await db.vendor.findFirstOrThrow({ where: { name: "Fresh Vendor" } })).code).toMatch(/^V-\d{5}$/);
  });

  it("bank details are saved for finance-capable roles; roles without vendor create rights are blocked", async () => {
    await loginAs("procurement@dsc.demo");
    await createVendor(fd({ name: "Bank Vendor A", bankDetails: "HDFC 1234" }));
    expect((await db.vendor.findFirstOrThrow({ where: { name: "Bank Vendor A" } })).bankDetails).toBe("HDFC 1234");
    await loginAs("pm@dsc.demo"); // PM can view vendors but not create them
    expect((await createVendor(fd({ name: "PM Vendor" }))).ok).toBe(false);
    await loginAs("designer@dsc.demo");
    expect((await createVendor(fd({ name: "Designer Vendor" }))).ok).toBe(false);
  });

  it("creates a material with auto SKU and blocks duplicate SKUs", async () => {
    await loginAs("store@dsc.demo");
    expect((await createMaterial(fd({ name: "Test Screw Box", unit: "box", purchaseCost: 120, minStock: 5, reorderLevel: 10 }))).ok).toBe(true);
    const m = await db.material.findFirstOrThrow({ where: { name: "Test Screw Box" } });
    expect(m.sku).toMatch(/^MAT-\d{5}$/);
    expect((await createMaterial(fd({ name: "Another", sku: m.sku }))).ok).toBe(false);
    expect((await createMaterial(fd({ name: "Bad levels", minStock: 50, reorderLevel: 10 }))).ok).toBe(false);
  });
});

describe("purchase approvals follow the configured thresholds", () => {
  const vendorId = async () => (await db.vendor.findFirstOrThrow({ where: { name: "Greenply Distributors" } })).id;
  const mkPo = async (qty: number, rate: number) => {
    const r = await createPurchaseOrder(fd({ vendorId: await vendorId(), items: items([{ description: `Threshold test ${qty}x${rate}`, unit: "nos", quantity: qty, rate, taxPercent: 0 }]) }));
    expect(r.ok).toBe(true);
    return db.purchaseOrder.findFirstOrThrow({ where: { items: { some: { description: `Threshold test ${qty}x${rate}` } } } });
  };

  it("≤ ₹25,000 → Project Manager, ₹25,000–₹1,00,000 → Management, above → Owner", async () => {
    await loginAs("procurement@dsc.demo");
    const small = await mkPo(10, 2000); // 20,000
    const mid = await mkPo(10, 6000); // 60,000
    const big = await mkPo(10, 15000); // 1,50,000
    for (const po of [small, mid, big]) expect((await submitPurchaseOrder(po.id)).ok).toBe(true);
    const role = async (id: string) => (await db.approval.findFirstOrThrow({ where: { entityId: id, status: "PENDING" } })).requiredRole;
    expect(await role(small.id)).toBe("PROJECT_MANAGER");
    expect(await role(mid.id)).toBe("MANAGEMENT");
    expect(await role(big.id)).toBe("OWNER");
    // procurement can't approve its own request at any level
    const apSmall = await db.approval.findFirstOrThrow({ where: { entityId: small.id, status: "PENDING" } });
    expect((await approveRequest(apSmall.id)).ok).toBe(false);
  });

  it("management cannot approve an Owner-level order; the Owner can", async () => {
    const big = await db.purchaseOrder.findFirstOrThrow({ where: { items: { some: { description: "Threshold test 10x15000" } } } });
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: big.id, status: "PENDING" } });
    await loginAs("director@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(false);
    await loginAs("owner@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(true);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: big.id } })).status).toBe("APPROVED");
  });

  it("a PM can approve small orders only for projects they manage", async () => {
    const small = await db.purchaseOrder.findFirstOrThrow({ where: { items: { some: { description: "Threshold test 10x2000" } } } });
    const p1 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00001" } }); // Amit
    await db.purchaseOrder.update({ where: { id: small.id }, data: { projectId: p1.id } });
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: small.id, status: "PENDING" } });
    await loginAs("pm2@dsc.demo"); // Kavita – not on PRJ-00001
    expect((await approveRequest(ap.id)).ok).toBe(false);
    await loginAs("pm@dsc.demo");
    expect((await approveRequest(ap.id)).ok).toBe(true);
  });

  it("an approved PO is locked; totals come from the server; the Owner's own PO is auto-approved", async () => {
    const approved = await db.purchaseOrder.findFirstOrThrow({ where: { items: { some: { description: "Threshold test 10x2000" } } } });
    await loginAs("procurement@dsc.demo");
    expect((await updatePurchaseOrder(approved.id, fd({ vendorId: approved.vendorId, items: items([{ description: "x", quantity: 1, rate: 1 }]) }))).ok).toBe(false);
    expect((await sendPurchaseOrder(approved.id)).ok).toBe(true);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: approved.id } })).status).toBe("SENT_TO_VENDOR");

    await loginAs("owner@dsc.demo");
    const r = await createPurchaseOrder(fd({ vendorId: approved.vendorId, discountPct: 10, items: items([{ description: "Owner PO item", unit: "nos", quantity: 4, rate: 1000, taxPercent: 18 }]), total: 1 }));
    expect(r.ok).toBe(true);
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { items: { some: { description: "Owner PO item" } } } });
    expect(Number(po.total)).toBe(4248); // 4000 − 10% = 3600, +18% = 4248
    await submitPurchaseOrder(po.id);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("APPROVED");
    expect((await cancelPurchaseOrder(po.id)).ok).toBe(true);
  });
});

describe("purchase requests", () => {
  it("a site engineer raises a request; value is estimated from the catalogue", async () => {
    await loginAs("engineer@dsc.demo");
    const p1 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00001" } });
    const ply = await mat("Plywood 18mm");
    const r = await createPurchaseRequest(fd({ projectId: p1.id, priority: "HIGH", items: items([{ materialId: ply.id, description: ply.name, unit: "sheet", quantity: 10 }]) }));
    expect(r.ok).toBe(true);
    const pr = await db.purchaseRequest.findFirstOrThrow({ where: { requestedById: (await db.user.findFirstOrThrow({ where: { email: "engineer@dsc.demo" } })).id, items: { some: { quantity: 10 } } } });
    expect((await submitPurchaseRequest(pr.id)).ok).toBe(true);
    const ap = await db.approval.findFirstOrThrow({ where: { entityId: pr.id, status: "PENDING" } });
    expect(Number(ap.amount)).toBe(28500); // 10 × ₹2,850 → above ₹25,000
    expect(ap.requiredRole).toBe("MANAGEMENT");
  });

  it("requires at least one valid item and respects project access", async () => {
    await loginAs("engineer@dsc.demo");
    expect((await createPurchaseRequest(fd({ items: items([]) }))).ok).toBe(false);
    const p4 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00004" } }); // engineer isn't on it
    expect((await createPurchaseRequest(fd({ projectId: p4.id, items: items([{ description: "x", quantity: 1 }]) }))).ok).toBe(false);
  });
});

describe("goods receipt updates stock and PO status", () => {
  let poId = "";
  let ply = "";
  let mainId = "";

  it("partial receipt: accepted quantity enters stock, damaged does not, PO becomes partially received", async () => {
    const main = await wh();
    mainId = main.id;
    const m = await mat("Gypsum board"); // approved seeded PO-00006: gypsum 150 + GI channel 250
    const po = await db.purchaseOrder.findFirstOrThrow({ where: { items: { some: { materialId: m.id } }, status: "APPROVED" }, include: { items: true } });
    poId = po.id;
    ply = m.id;
    const before = await stockAt(m.id, main.id);
    const gi = po.items.find((i) => i.materialId !== m.id)!;
    const g = po.items.find((i) => i.materialId === m.id)!;
    await loginAs("store@dsc.demo");
    const r = await createReceipt(fd({ poId, locationId: main.id, deliveryDate: "2030-01-10", challanNo: "CH-77", items: items([{ poItemId: g.id, receivedQty: 100, damagedQty: 4, rejectedQty: 1 }, { poItemId: gi.id, receivedQty: 0 }]) }));
    expect(r.ok).toBe(true);
    expect(await stockAt(m.id, main.id)).toBe(before + 95);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe("PARTIALLY_RECEIVED");
    const item = await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: g.id } });
    expect(Number(item.receivedQty)).toBe(95);
    const txn = await db.inventoryTransaction.findFirstOrThrow({ where: { materialId: m.id, refType: "MATERIAL_RECEIPT" }, orderBy: { createdAt: "desc" } });
    expect(txn.type).toBe("INWARD");
    expect(Number(txn.quantity)).toBe(95);
  });

  it("refuses to receive more than is pending, or damaged > received", async () => {
    await loginAs("store@dsc.demo");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
    const g = po.items.find((i) => i.materialId === ply)!;
    expect((await createReceipt(fd({ poId, locationId: mainId, deliveryDate: "2030-01-11", items: items([{ poItemId: g.id, receivedQty: 100 }]) }))).ok).toBe(false); // only 55 pending
    expect((await createReceipt(fd({ poId, locationId: mainId, deliveryDate: "2030-01-11", items: items([{ poItemId: g.id, receivedQty: 5, damagedQty: 9 }]) }))).ok).toBe(false);
  });

  it("completing the delivery marks the PO received and notifies procurement", async () => {
    await loginAs("store@dsc.demo");
    const po = await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
    const lines = po.items.map((i) => ({ poItemId: i.id, receivedQty: Number(i.quantity) - Number(i.receivedQty) }));
    expect((await createReceipt(fd({ poId, locationId: mainId, deliveryDate: "2030-01-12", items: items(lines) }))).ok).toBe(true);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: poId } })).status).toBe("RECEIVED");
    const procurement = await db.user.findFirstOrThrow({ where: { email: "procurement@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: procurement.id, title: { contains: "fully received" } } })).toBeGreaterThan(0);
    // a received order can't take another delivery
    expect((await createReceipt(fd({ poId, locationId: mainId, deliveryDate: "2030-01-13", items: items([{ poItemId: po.items[0].id, receivedQty: 1 }]) }))).ok).toBe(false);
  });

  it("only users with inventory create rights can receive", async () => {
    await loginAs("sales@dsc.demo");
    expect((await createReceipt(fd({ poId, locationId: mainId, deliveryDate: "2030-01-13", items: items([]) }))).ok).toBe(false);
  });
});

describe("issue to site, returns and consumption", () => {
  it("moves stock warehouse → site store, creates the ledger entry and charges the project", async () => {
    const main = await wh();
    const p2 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
    const led = await mat("LED panel");
    const before = await stockAt(led.id, main.id);
    const finBefore = (await projectFinancials(p2.companyId, [p2.id])).get(p2.id)!;
    await loginAs("store@dsc.demo");
    const r = await createIssue(fd({ projectId: p2.id, fromLocationId: main.id, receivedBy: "Tushar", purpose: "Lighting", items: items([{ materialId: led.id, quantity: 10 }]) }));
    expect(r.ok).toBe(true);
    const site = await db.warehouse.findFirstOrThrow({ where: { projectId: p2.id, type: "SITE" } });
    expect(await stockAt(led.id, main.id)).toBe(before - 10);
    expect(await stockAt(led.id, site.id)).toBe(10);
    const finAfter = (await projectFinancials(p2.companyId, [p2.id])).get(p2.id)!;
    expect(finAfter.material - finBefore.material).toBe(12500); // 10 × ₹1,250
    expect(finAfter.profit).toBe(finBefore.profit - 12500);
  });

  it("refuses to issue more than is in stock – stock never goes negative", async () => {
    const main = await wh();
    const p2 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
    const prim = await mat("Primer 20L");
    const have = await stockAt(prim.id, main.id);
    await loginAs("store@dsc.demo");
    const r = await createIssue(fd({ projectId: p2.id, fromLocationId: main.id, items: items([{ materialId: prim.id, quantity: have + 1 }]) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Not enough/);
    expect(await stockAt(prim.id, main.id)).toBe(have);
  });

  it("is atomic under concurrency: two simultaneous issues cannot both take the last units", async () => {
    const main = await wh();
    const p2 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
    const prim = await mat("Primer 20L");
    const have = await stockAt(prim.id, main.id);
    await loginAs("store@dsc.demo");
    const take = Math.ceil(have * 0.6);
    const results = await Promise.all([1, 2].map(() => createIssue(fd({ projectId: p2.id, fromLocationId: main.id, items: items([{ materialId: prim.id, quantity: take }]) }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const left = await stockAt(prim.id, main.id);
    expect(left).toBe(have - take);
    expect(left).toBeGreaterThanOrEqual(0);
  });

  it("a rolled-back issue leaves no partial changes", async () => {
    const main = await wh();
    const p2 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
    const putty = await mat("Wall putty");
    const prim = await mat("Primer 20L");
    const before = await stockAt(putty.id, main.id);
    const txnBefore = await db.inventoryTransaction.count();
    await loginAs("store@dsc.demo");
    // first line is fine, second is impossible → whole issue must roll back
    const r = await createIssue(fd({ projectId: p2.id, fromLocationId: main.id, items: items([{ materialId: putty.id, quantity: 5 }, { materialId: prim.id, quantity: 99999 }]) }));
    expect(r.ok).toBe(false);
    expect(await stockAt(putty.id, main.id)).toBe(before);
    expect(await db.inventoryTransaction.count()).toBe(txnBefore);
  });

  it("returning unused material credits the project and restores warehouse stock", async () => {
    const main = await wh();
    const p2 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
    const led = await mat("LED panel");
    const before = (await projectFinancials(p2.companyId, [p2.id])).get(p2.id)!;
    const whBefore = await stockAt(led.id, main.id);
    await loginAs("store@dsc.demo");
    expect((await createReturn(fd({ projectId: p2.id, toLocationId: main.id, note: "Excess", items: items([{ materialId: led.id, quantity: 4 }]) }))).ok).toBe(true);
    expect(await stockAt(led.id, main.id)).toBe(whBefore + 4);
    const after = (await projectFinancials(p2.companyId, [p2.id])).get(p2.id)!;
    expect(before.material - after.material).toBe(5000); // 4 × ₹1,250 credited
    // can't return more than is on site
    expect((await createReturn(fd({ projectId: p2.id, toLocationId: main.id, items: items([{ materialId: led.id, quantity: 500 }]) }))).ok).toBe(false);
  });

  it("consumption reduces site stock; adjustments and damage need a reason", async () => {
    const p2 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00002" } });
    const site = await db.warehouse.findFirstOrThrow({ where: { projectId: p2.id, type: "SITE" } });
    const main = await wh();
    const led = await mat("LED panel");
    const onSite = await stockAt(led.id, site.id);
    await loginAs("supervisor@dsc.demo");
    expect((await recordMovement(fd({ type: "CONSUMED", materialId: led.id, quantity: 2, fromLocationId: site.id }))).ok).toBe(true);
    expect(await stockAt(led.id, site.id)).toBe(onSite - 2);
    expect((await recordMovement(fd({ type: "DAMAGED", materialId: led.id, quantity: 1, fromLocationId: site.id }))).ok).toBe(false); // no reason
    expect((await recordMovement(fd({ type: "DAMAGED", materialId: led.id, quantity: 1, fromLocationId: site.id, note: "Broken in transit" }))).ok).toBe(true);
    expect((await recordMovement(fd({ type: "CONSUMED", materialId: led.id, quantity: 9999, fromLocationId: site.id }))).ok).toBe(false);
    // transfer between warehouses keeps total constant
    await loginAs("store@dsc.demo");
    const yard = await db.warehouse.findFirstOrThrow({ where: { name: "Navi Mumbai Yard" } });
    const t0 = (await stockAt(led.id, main.id)) + (await stockAt(led.id, yard.id));
    expect((await recordMovement(fd({ type: "TRANSFER", materialId: led.id, quantity: 5, fromLocationId: main.id, toLocationId: yard.id }))).ok).toBe(true);
    expect((await stockAt(led.id, main.id)) + (await stockAt(led.id, yard.id))).toBe(t0);
    expect(await stockAt(led.id, yard.id)).toBe(5);
  });

  it("alerts procurement when stock falls to the reorder level (once a day)", async () => {
    const main = await wh();
    const putty = await mat("Wall putty");
    await loginAs("store@dsc.demo");
    const have = await stockAt(putty.id, main.id);
    const reorder = Number(putty.reorderLevel);
    expect((await recordMovement(fd({ type: "DAMAGED", materialId: putty.id, quantity: have - reorder + 1, fromLocationId: main.id, note: "Water damage" }))).ok).toBe(true);
    expect((await recordMovement(fd({ type: "DAMAGED", materialId: putty.id, quantity: 1, fromLocationId: main.id, note: "More damage" }))).ok).toBe(true);
    const proc = await db.user.findFirstOrThrow({ where: { email: "procurement@dsc.demo" } });
    expect(await db.notification.count({ where: { userId: proc.id, type: "LOW_STOCK", title: { contains: "Wall putty" } } })).toBe(1);
  });

  it("moving-average cost: receiving at a new price re-averages the stock value", async () => {
    const main = await wh();
    const ad = await mat("Tile adhesive");
    const bal = await db.stockBalance.findUniqueOrThrow({ where: { materialId_locationId: { materialId: ad.id, locationId: main.id } } });
    const qty = Number(bal.quantity);
    const avg = Number(bal.avgCost);
    await loginAs("store@dsc.demo");
    expect((await recordMovement(fd({ type: "ADJUSTMENT_ADD", materialId: ad.id, quantity: qty, toLocationId: main.id, unitCost: avg + 100, note: "Test re-average" }))).ok).toBe(true);
    const after = await db.stockBalance.findUniqueOrThrow({ where: { materialId_locationId: { materialId: ad.id, locationId: main.id } } });
    expect(Number(after.quantity)).toBe(qty * 2);
    expect(Number(after.avgCost)).toBe(avg + 50);
  });

  it("project material plan compares BOQ plan with purchased, issued and consumed", async () => {
    const p1 = await db.project.findFirstOrThrow({ where: { code: "PRJ-00001" } });
    const plan = await projectMaterialPlan(p1.companyId, p1.id);
    const ply = plan.find((r) => r.name.startsWith("Plywood 18mm"))!;
    expect(ply.planned).toBe(60);
    expect(ply.purchased).toBe(40);
    expect(ply.issued).toBe(28);
    expect(ply.consumed).toBe(22);
    expect(ply.onSite).toBe(6);
    expect(ply.toBuy).toBe(20);
  });
});
