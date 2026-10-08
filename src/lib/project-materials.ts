import "server-only";
import { db } from "./db";
import { num } from "./utils";

export type MaterialPlanRow = {
  materialId: string;
  name: string;
  unit: string;
  planned: number; // from the project's current BOQ
  purchased: number; // ordered on non-cancelled POs for this project
  received: number; // accepted into stock
  issued: number; // net issued to site (issues − returns)
  consumed: number;
  onSite: number; // balance at the site store
  toBuy: number; // planned − purchased (never negative)
  overUse: boolean; // issued more than planned
};

/** BOQ planned vs purchased vs received vs issued vs consumed vs remaining – per material for one project. */
export async function projectMaterialPlan(companyId: string, projectId: string): Promise<MaterialPlanRow[]> {
  const [boqs, poItems, issueItems, consumed, site] = await Promise.all([
    db.boq.findMany({ where: { companyId, projectId, deletedAt: null, status: { not: "REVISED" } }, orderBy: { revision: "desc" }, include: { items: { where: { materialId: { not: null } }, select: { materialId: true, quantity: true } } } }),
    db.purchaseOrderItem.findMany({ where: { materialId: { not: null }, po: { companyId, projectId, status: { notIn: ["DRAFT", "CANCELLED", "PENDING_APPROVAL"] } } }, select: { materialId: true, quantity: true, receivedQty: true } }),
    db.materialIssueItem.findMany({ where: { issue: { companyId, projectId } }, select: { materialId: true, quantity: true } }),
    db.inventoryTransaction.groupBy({ by: ["materialId"], where: { companyId, projectId, type: "CONSUMED" }, _sum: { quantity: true } }),
    db.warehouse.findFirst({ where: { companyId, projectId, type: "SITE" }, include: { stock: true } }),
  ]);
  const boq = boqs.find((b) => b.status === "APPROVED") ?? boqs[0];

  const map = new Map<string, MaterialPlanRow>();
  const row = (id: string): MaterialPlanRow => {
    let r = map.get(id);
    if (!r) {
      r = { materialId: id, name: "", unit: "", planned: 0, purchased: 0, received: 0, issued: 0, consumed: 0, onSite: 0, toBuy: 0, overUse: false };
      map.set(id, r);
    }
    return r;
  };
  for (const i of boq?.items ?? []) row(i.materialId!).planned += num(i.quantity);
  for (const i of poItems) {
    const r = row(i.materialId!);
    r.purchased += num(i.quantity);
    r.received += num(i.receivedQty);
  }
  for (const i of issueItems) row(i.materialId).issued += num(i.quantity);
  for (const c of consumed) row(c.materialId).consumed += num(c._sum.quantity);
  for (const b of site?.stock ?? []) row(b.materialId).onSite += num(b.quantity);

  const mats = await db.material.findMany({ where: { id: { in: [...map.keys()] } }, select: { id: true, name: true, unit: true } });
  for (const m of mats) {
    const r = map.get(m.id)!;
    r.name = m.name;
    r.unit = m.unit;
  }
  for (const r of map.values()) {
    r.toBuy = Math.max(0, r.planned - r.purchased);
    r.overUse = r.planned > 0 && r.issued > r.planned;
  }
  return [...map.values()].filter((r) => r.name).sort((a, b) => a.name.localeCompare(b.name));
}
