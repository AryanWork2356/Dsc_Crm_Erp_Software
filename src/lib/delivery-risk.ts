import "server-only";
import type { DelayReason } from "@prisma/client";
import { db } from "./db";
import { raiseAction, resolveActionsFor } from "./action-items";
import { notifyUsers } from "./notify";
import { num, startOfDay } from "./utils";

/**
 * Late-delivery watch. For every line of an open purchase order still waiting for material:
 *   need-by date = the line's own, else the order's delivery date; promised date = the supplier's latest promise, else the order's delivery date.
 *   LATE    : the promised date has passed and material is still outstanding.
 *   AT RISK : the promised date is after the need-by date (it will arrive too late for the site).
 * A late or at-risk line raises ONE action for procurement (and tells the project manager) and closes it when the line is
 * received or the dates are fixed. The reason (DSC's own late request, supplier, transport, drawings, site access …) is recorded.
 */

export const DELAY_LABEL: Record<DelayReason, string> = {
  DSC_LATE_REQUEST: "Our request or approval was late",
  SUPPLIER_DELAY: "Supplier delay",
  TRANSPORT: "Transport",
  SPEC_CHANGE: "Specification or drawing changed",
  SITE_ACCESS: "Client or site access",
  OTHER: "Other",
  UNKNOWN: "Not known yet",
};

const OPEN_PO = ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] as const;
const DAY = 86400000;

export type RiskStatus = "LATE" | "AT_RISK" | "OK";

export function riskOf(needBy: Date | null, eta: Date | null, today: Date): { status: RiskStatus; daysLate: number } {
  if (eta && eta.getTime() < today.getTime()) return { status: "LATE", daysLate: Math.round((today.getTime() - eta.getTime()) / DAY) };
  if (eta && needBy && eta.getTime() > needBy.getTime()) return { status: "AT_RISK", daysLate: Math.round((eta.getTime() - needBy.getTime()) / DAY) };
  return { status: "OK", daysLate: 0 };
}

export type LineRisk = {
  itemId: string; poId: string; poNumber: string; projectId: string | null; projectCode: string | null; vendorName: string; description: string; unit: string;
  outstanding: number; needBy: Date | null; eta: Date | null; status: RiskStatus; daysLate: number; reason: DelayReason | null; recoveryNote: string | null;
};

/** Every outstanding line with its risk. `projectIds` limits what the viewer may see (null = all). */
export async function deliveryLines(companyId: string, projectIds: string[] | null, today: Date = startOfDay()): Promise<LineRisk[]> {
  const pos = await db.purchaseOrder.findMany({
    where: { companyId, status: { in: [...OPEN_PO] }, ...(projectIds ? { OR: [{ projectId: { in: projectIds } }] } : {}) },
    include: { vendor: { select: { name: true } }, project: { select: { code: true } }, items: true },
    take: 500,
  });
  const out: LineRisk[] = [];
  for (const po of pos) {
    for (const i of po.items) {
      const outstanding = num(i.quantity) - num(i.receivedQty);
      if (outstanding <= 0) continue;
      const needBy = i.needBy ?? po.deliveryDate;
      const eta = i.promisedEta ?? po.deliveryDate;
      const r = riskOf(needBy, eta, today);
      out.push({ itemId: i.id, poId: po.id, poNumber: po.number, projectId: po.projectId, projectCode: po.project?.code ?? null, vendorName: po.vendor.name, description: i.description, unit: i.unit, outstanding, needBy, eta, status: r.status, daysLate: r.daysLate, reason: i.delayReason, recoveryNote: i.recoveryNote });
    }
  }
  return out.sort((a, b) => (a.status === b.status ? b.daysLate - a.daysLate : a.status === "LATE" ? -1 : a.status === "AT_RISK" && b.status === "OK" ? -1 : 1));
}

/** One action per risky line; closes the action when the line is fine again. Safe to repeat. */
export async function syncDeliveryRisks(companyId: string, now: Date = new Date()): Promise<{ raised: number; closed: number }> {
  const today = startOfDay(now);
  const lines = await deliveryLines(companyId, null, today);
  const procurement = await db.user.findFirst({ where: { companyId, role: "PROCUREMENT", isActive: true, deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
  const fallback = procurement ?? (await db.user.findFirst({ where: { companyId, role: { in: ["MANAGEMENT", "OWNER"] }, isActive: true, deletedAt: null }, select: { id: true } }));
  let raised = 0;
  let closed = 0;
  const risky = new Set(lines.filter((l) => l.status !== "OK").map((l) => l.itemId));
  for (const l of lines) {
    if (l.status === "OK") continue;
    const po = await db.purchaseOrder.findUnique({ where: { id: l.poId }, select: { createdById: true, project: { select: { projectManagerId: true } } } });
    const owner = (po?.createdById && (await db.user.findFirst({ where: { id: po.createdById, isActive: true, deletedAt: null }, select: { id: true } }))?.id) || fallback?.id;
    if (!owner) continue;
    const late = l.status === "LATE";
    const r = await raiseAction(db, {
      companyId, title: `${late ? "Late" : "Will arrive too late"}: ${l.description} (${l.poNumber}${l.projectCode ? `, ${l.projectCode}` : ""})`, severity: late ? "HIGH" : "MEDIUM", ownerId: owner, createdById: owner, projectId: l.projectId,
      dueDate: new Date(today.getTime() + DAY - 60000),
      detail: `${l.vendorName}: ${l.outstanding} ${l.unit} still to come. ${late ? `Promised ${l.eta?.toLocaleDateString("en-IN")}, ${l.daysLate} day(s) ago.` : `Promised ${l.eta?.toLocaleDateString("en-IN")} but needed by ${l.needBy?.toLocaleDateString("en-IN")}.`} Record the reason and the recovery plan on the Deliveries page.`,
      sourceType: "PurchaseOrderItem", sourceId: l.itemId, sourceLabel: `${l.poNumber} line`, link: "/procurement/deliveries",
    });
    if (r.created && po?.project?.projectManagerId && po.project.projectManagerId !== owner) {
      await notifyUsers([po.project.projectManagerId], { companyId, type: "GENERAL", title: `Delivery ${late ? "late" : "at risk"}: ${l.description}`, body: `${l.poNumber} · ${l.vendorName}`, link: "/procurement/deliveries", dedupeKey: `delivery:${l.itemId}:${late ? "late" : "risk"}` });
    }
    if (r.created) raised++;
  }
  // close the actions of lines that are fine again (received, or the dates were fixed)
  const open = await db.actionItem.findMany({ where: { companyId, sourceType: "PurchaseOrderItem", status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true, sourceId: true, createdById: true } });
  for (const a of open) {
    if (a.sourceId && !risky.has(a.sourceId)) { await resolveActionsFor(db, companyId, "PurchaseOrderItem", a.sourceId, a.createdById, "The delivery arrived or its dates were corrected."); closed++; }
  }
  return { raised, closed };
}
