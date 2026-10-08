import "server-only";
import type { InventoryTxnType } from "@prisma/client";
import type { Tx } from "./db";
import type { Ctx } from "./auth";
import { UserError } from "./action";
import { notifyRoles } from "./notify";
import { num, round2 } from "./utils";

/**
 * Inventory engine. Stock is NEVER set directly – every change is an InventoryTransaction (the ledger)
 * and the StockBalance is updated in the same database transaction.
 *
 *  INWARD     → add to `toLocation` at `unitCost` (moving-average cost)
 *  OUTWARD    → remove from `fromLocation` (optionally add to `toLocation`, e.g. issue to site)
 *  TRANSFER   → fromLocation → toLocation
 *  RETURN     → toLocation gets stock back (optionally from `fromLocation`, e.g. site → warehouse)
 *  ADJUSTMENT → +qty at `toLocation`, or −qty at `fromLocation` (stock-take corrections)
 *  DAMAGED    → remove from `fromLocation` (write-off)
 *  CONSUMED   → remove from `fromLocation` (used up on site)
 *
 * Removing more than is available is refused (no negative stock), enforced atomically in SQL.
 */

export type Movement = {
  type: InventoryTxnType;
  materialId: string;
  quantity: number; // always positive
  unitCost?: number; // for stock coming in from outside (INWARD / +ADJUSTMENT)
  fromLocationId?: string | null;
  toLocationId?: string | null;
  projectId?: string | null;
  refType?: string;
  refId?: string;
  note?: string;
};

async function add(tx: Tx, companyId: string, materialId: string, locationId: string, qty: number, unitCost: number) {
  const bal = await tx.stockBalance.upsert({
    where: { materialId_locationId: { materialId, locationId } },
    create: { companyId, materialId, locationId, quantity: qty, avgCost: unitCost },
    update: { quantity: { increment: qty } },
  });
  // moving average: previous qty = new qty − added qty
  const prev = num(bal.quantity) - qty;
  if (prev > 0) {
    const avg = round2((prev * num(bal.avgCost) + qty * unitCost) / (prev + qty));
    await tx.stockBalance.update({ where: { id: bal.id }, data: { avgCost: avg } });
  } else if (bal.avgCost.toString() !== String(unitCost)) {
    await tx.stockBalance.update({ where: { id: bal.id }, data: { avgCost: unitCost } });
  }
}

/** Atomically remove stock; returns the average cost at the moment of removal. */
async function remove(tx: Tx, materialId: string, locationId: string, qty: number): Promise<number> {
  const rows = await tx.$queryRaw<{ avgCost: number }[]>`
    UPDATE "StockBalance"
       SET quantity = quantity - ${qty}
     WHERE "materialId" = ${materialId} AND "locationId" = ${locationId}
       AND quantity - reserved >= ${qty}
 RETURNING "avgCost"::float AS "avgCost"`;
  if (rows.length === 0) {
    const [m, l, b] = await Promise.all([
      tx.material.findUnique({ where: { id: materialId }, select: { name: true, unit: true } }),
      tx.warehouse.findUnique({ where: { id: locationId }, select: { name: true } }),
      tx.stockBalance.findUnique({ where: { materialId_locationId: { materialId, locationId } } }),
    ]);
    const have = b ? num(b.quantity) - num(b.reserved) : 0;
    throw new UserError(`Not enough ${m?.name ?? "stock"} at ${l?.name ?? "that location"}: ${have} ${m?.unit ?? ""} available, ${qty} needed.`);
  }
  return rows[0].avgCost;
}

export async function move(tx: Tx, c: Pick<Ctx, "companyId" | "userId">, m: Movement): Promise<{ unitCost: number }> {
  if (!(m.quantity > 0)) throw new UserError("Quantity must be above 0.");
  const material = await tx.material.findFirst({ where: { id: m.materialId, companyId: c.companyId, deletedAt: null }, select: { id: true, reorderLevel: true } });
  if (!material) throw new UserError("Material not found.");

  const locs = [m.fromLocationId, m.toLocationId].filter(Boolean) as string[];
  if (locs.length) {
    const found = await tx.warehouse.count({ where: { id: { in: locs }, companyId: c.companyId, isActive: true } });
    if (found !== new Set(locs).size) throw new UserError("Stock location not found or inactive.");
  }
  if (m.fromLocationId && m.fromLocationId === m.toLocationId) throw new UserError("From and To locations must be different.");

  const needFrom: InventoryTxnType[] = ["OUTWARD", "TRANSFER", "DAMAGED", "CONSUMED"];
  const needTo: InventoryTxnType[] = ["INWARD", "TRANSFER", "RETURN"];
  if (needFrom.includes(m.type) && !m.fromLocationId) throw new UserError("Choose where the stock is coming from.");
  if (needTo.includes(m.type) && !m.toLocationId) throw new UserError("Choose where the stock is going to.");
  if (m.type === "ADJUSTMENT" && !m.fromLocationId && !m.toLocationId) throw new UserError("Choose a location.");

  let cost = m.unitCost ?? 0;
  if (m.fromLocationId) cost = await remove(tx, m.materialId, m.fromLocationId, m.quantity);
  if (m.toLocationId) await add(tx, c.companyId, m.materialId, m.toLocationId, m.quantity, m.fromLocationId ? cost : (m.unitCost ?? 0));

  await tx.inventoryTransaction.create({
    data: {
      companyId: c.companyId, type: m.type, materialId: m.materialId, fromLocationId: m.fromLocationId ?? null, toLocationId: m.toLocationId ?? null,
      quantity: m.quantity, unitCost: cost, projectId: m.projectId ?? null, refType: m.refType ?? "MANUAL", refId: m.refId, note: m.note, createdById: c.userId,
    },
  });

  if (m.fromLocationId) await checkLowStock(tx, c.companyId, m.materialId, num(material.reorderLevel));
  return { unitCost: cost };
}

/** Alert procurement when total warehouse stock falls to the reorder level (once per material per day). */
async function checkLowStock(tx: Tx, companyId: string, materialId: string, reorderLevel: number) {
  if (reorderLevel <= 0) return;
  const agg = await tx.stockBalance.aggregate({ where: { materialId, location: { type: "WAREHOUSE" } }, _sum: { quantity: true } });
  const total = num(agg._sum.quantity);
  if (total > reorderLevel) return;
  const m = await tx.material.findUnique({ where: { id: materialId }, select: { name: true, unit: true } });
  const day = new Date().toISOString().slice(0, 10);
  await notifyRoles(companyId, ["PROCUREMENT", "STORE"], {
    type: "LOW_STOCK", title: `Low stock: ${m?.name}`, body: `${total} ${m?.unit} left (reorder level ${reorderLevel}). Raise a purchase request.`,
    link: `/inventory/stock?low=1`, dedupeKey: `lowstock:${materialId}:${day}`,
  }, tx);
}

/** The project's site stock location – created on first use. */
export async function siteLocation(tx: Tx, companyId: string, projectId: string): Promise<string> {
  const existing = await tx.warehouse.findFirst({ where: { companyId, projectId, type: "SITE" } });
  if (existing) return existing.id;
  const p = await tx.project.findUnique({ where: { id: projectId }, select: { code: true, name: true, siteAddress: true } });
  const w = await tx.warehouse.create({ data: { companyId, name: `Site – ${p?.code} ${p?.name ?? ""}`.trim(), type: "SITE", projectId, address: p?.siteAddress } });
  return w.id;
}
