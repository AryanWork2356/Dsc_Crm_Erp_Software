import "server-only";
import type { PoStatus, PurchaseRequestStatus } from "@prisma/client";
import { db } from "./db";
import { num } from "./utils";

/**
 * What was asked for, what was ordered, what arrived, and what is still to be sent – per request and per project.
 * A request line and an order line are the same material when they share the catalogue material, or else the same name and unit.
 */

/** Orders that count as "ordered": approved by the company (drafts, ones waiting for approval and cancelled ones do not). */
export const ORDERED: PoStatus[] = ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"];
/** Requests that count as "requested": sent by the site (drafts and rejected ones do not). */
export const ASKED: PurchaseRequestStatus[] = ["PENDING_APPROVAL", "APPROVED", "ORDERED"];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const itemKey = (i: { materialId: string | null; description: string; unit: string }) => (i.materialId ? `m:${i.materialId}` : `d:${norm(i.description)}|${norm(i.unit)}`);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type LineStatus = { key: string; description: string; unit: string; requested: number; ordered: number; received: number; pending: number };

type PoLine = { materialId: string | null; description: string; unit: string; quantity: unknown; receivedQty: unknown };
function orderedBy(lines: PoLine[]) {
  const m = new Map<string, { ordered: number; received: number }>();
  for (const l of lines) {
    const k = itemKey(l);
    const cur = m.get(k) ?? { ordered: 0, received: 0 };
    cur.ordered += num(l.quantity as number);
    cur.received += num(l.receivedQty as number);
    m.set(k, cur);
  }
  return m;
}

/** One request, line by line (the same material asked twice in it is one line). */
export async function requestLines(requestId: string): Promise<LineStatus[]> {
  const [items, poItems] = await Promise.all([
    db.purchaseRequestItem.findMany({ where: { requestId }, orderBy: { id: "asc" } }),
    db.purchaseOrderItem.findMany({ where: { po: { requestId, status: { in: ORDERED } } } }),
  ]);
  return linesFor(items, orderedBy(poItems));
}

function linesFor(items: { materialId: string | null; description: string; unit: string; quantity: unknown }[], got: Map<string, { ordered: number; received: number }>): LineStatus[] {
  const out = new Map<string, LineStatus>();
  for (const i of items) {
    const k = itemKey(i);
    const cur = out.get(k) ?? { key: k, description: i.description, unit: i.unit, requested: 0, ordered: 0, received: 0, pending: 0 };
    cur.requested += num(i.quantity as number);
    out.set(k, cur);
  }
  for (const l of out.values()) {
    const g = got.get(l.key);
    l.requested = r3(l.requested);
    l.ordered = r3(g?.ordered ?? 0);
    l.received = r3(g?.received ?? 0);
    l.pending = r3(Math.max(l.requested - l.ordered, 0));
  }
  return [...out.values()];
}

/** Everything about one project's material and money, for the history PDF. `money` leaves out every amount when false. */
export async function projectHistory(companyId: string, projectId: string) {
  const [requests, orders, expenses, invoices] = await Promise.all([
    db.purchaseRequest.findMany({ where: { companyId, projectId }, include: { items: { orderBy: { id: "asc" } } }, orderBy: { createdAt: "asc" } }),
    db.purchaseOrder.findMany({ where: { companyId, projectId }, include: { items: true, vendor: { select: { name: true } } }, orderBy: { orderDate: "asc" } }),
    db.expense.findMany({ where: { companyId, projectId, rejectedAt: null }, orderBy: { date: "asc" } }),
    db.invoice.findMany({ where: { companyId, projectId, deletedAt: null, status: { notIn: ["CANCELLED", "DRAFT"] } }, include: { payments: { orderBy: { date: "asc" } } }, orderBy: { issueDate: "asc" } }),
  ]);
  const poIds = orders.map((o) => o.id);
  const bills = await db.vendorBill.findMany({
    where: { companyId, status: { not: "CANCELLED" }, OR: [{ projectId }, ...(poIds.length ? [{ poId: { in: poIds } }] : [])] },
    include: { vendor: { select: { name: true } }, po: { select: { number: true } }, payments: { orderBy: { date: "asc" } } },
    orderBy: { billDate: "asc" },
  });
  const people = await db.user.findMany({ where: { id: { in: [...new Set(requests.map((r) => r.requestedById))] } }, select: { id: true, name: true } });
  const who = new Map(people.map((p) => [p.id, p.name]));

  const placed = orders.filter((o) => ORDERED.includes(o.status));
  const byRequest = new Map<string, PoLine[]>();
  for (const o of placed) if (o.requestId) byRequest.set(o.requestId, [...(byRequest.get(o.requestId) ?? []), ...o.items]);

  const requestRows = requests.map((r) => ({
    id: r.id, number: r.number, date: r.createdAt, neededBy: r.requiredDate, status: r.status, by: who.get(r.requestedById) ?? "", reason: r.reason,
    lines: linesFor(r.items, orderedBy(byRequest.get(r.id) ?? [])),
  }));

  // each material over the whole project: asked for (sent requests), ordered and received (all approved orders for the project), spent
  const asked = requests.filter((r) => ASKED.includes(r.status)).flatMap((r) => r.items);
  const mats = new Map<string, LineStatus & { value: number }>();
  for (const i of asked) {
    const k = itemKey(i);
    const m = mats.get(k) ?? { key: k, description: i.description, unit: i.unit, requested: 0, ordered: 0, received: 0, pending: 0, value: 0 };
    m.requested += num(i.quantity);
    mats.set(k, m);
  }
  for (const l of placed.flatMap((o) => o.items)) {
    const k = itemKey(l);
    const m = mats.get(k) ?? { key: k, description: l.description, unit: l.unit, requested: 0, ordered: 0, received: 0, pending: 0, value: 0 };
    m.ordered += num(l.quantity);
    m.received += num(l.receivedQty);
    m.value += num(l.amount);
    mats.set(k, m);
  }
  const materials = [...mats.values()]
    .map((m) => ({ ...m, requested: r3(m.requested), ordered: r3(m.ordered), received: r3(m.received), pending: r3(Math.max(m.requested - m.ordered, 0)), value: Math.round(m.value * 100) / 100 }))
    .sort((a, b) => a.description.localeCompare(b.description));

  const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
  const vendorPayments = bills.flatMap((b) => b.payments.map((p) => ({ ...p, vendor: b.vendor.name, bill: b.number })));
  const clientPayments = invoices.flatMap((i) => i.payments.map((p) => ({ ...p, invoice: i.number })));
  const money = {
    ordered: sum(placed.map((o) => num(o.total))),
    billed: sum(bills.map((b) => num(b.amount))),
    paidVendors: sum(bills.map((b) => num(b.paid))),
    expenses: sum(expenses.filter((e) => e.approved).map((e) => num(e.amount))),
    invoiced: sum(invoices.map((i) => num(i.total))),
    received: sum(invoices.map((i) => num(i.paid))),
  };
  return { requests: requestRows, orders, bills, vendorPayments, expenses, invoices, clientPayments, materials, money };
}
