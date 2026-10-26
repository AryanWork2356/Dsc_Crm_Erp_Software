import "server-only";
import type { ClientPO, Invoice } from "@prisma/client";
import { db } from "./db";
import { num, round2 } from "./utils";

/**
 * One company's money story, all from real records:
 *   quoted           – quotations sent to the company
 *   PO value         – what the client has ordered (their purchase orders, excl. GST)
 *   billed           – invoices issued against that PO (excl. GST)
 *   received         – payments recorded against those invoices
 *   left to bill     – PO value − billed
 *   left to collect  – invoice totals (incl. GST) − received
 * Invoices that are not tied to a PO are shown on their own line so nothing hides.
 */

const ISSUED = ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;
const LIVE = ["DRAFT", "PENDING_APPROVAL", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;
const net = (i: Pick<Invoice, "subtotal" | "discount">) => num(i.subtotal) - num(i.discount);

export type PoLine = {
  po: ClientPO;
  billed: number; // issued invoices, excl. GST
  committedBilling: number; // everything not cancelled, drafts included: what the over-billing check uses
  received: number;
  leftToBill: number;
  leftToCollect: number;
  invoices: { id: string; number: string; status: string; net: number; total: number; paid: number; dueDate: Date | null }[];
};

export type ClientAccount = {
  quotations: { id: string; number: string; title: string | null; total: number; status: string; date: Date }[];
  pos: PoLine[];
  noPo: { count: number; billed: number; received: number; leftToCollect: number };
  totals: { poValue: number; billed: number; received: number; leftToBill: number; leftToCollect: number };
};

export async function clientAccount(companyId: string, clientId: string): Promise<ClientAccount> {
  const [pos, invoices, quotes] = await Promise.all([
    db.clientPO.findMany({ where: { companyId, clientId }, orderBy: { createdAt: "desc" } }),
    db.invoice.findMany({ where: { companyId, clientId, deletedAt: null, status: { in: [...LIVE] } }, select: { id: true, number: true, status: true, subtotal: true, discount: true, total: true, paid: true, dueDate: true, clientPoId: true }, orderBy: { issueDate: "asc" } }),
    db.quotation.findMany({ where: { companyId, clientId, deletedAt: null }, select: { id: true, number: true, title: true, total: true, status: true, date: true }, orderBy: { date: "desc" }, take: 50 }),
  ]);
  const issued = (s: string) => (ISSUED as readonly string[]).includes(s);
  const lines: PoLine[] = pos.map((po) => {
    const mine = invoices.filter((i) => i.clientPoId === po.id);
    const billed = round2(mine.filter((i) => issued(i.status)).reduce((s, i) => s + net(i), 0));
    const received = round2(mine.filter((i) => issued(i.status)).reduce((s, i) => s + num(i.paid), 0));
    return {
      po, billed, committedBilling: round2(mine.reduce((s, i) => s + net(i), 0)), received,
      leftToBill: round2(num(po.amount) - billed),
      leftToCollect: round2(mine.filter((i) => issued(i.status)).reduce((s, i) => s + (num(i.total) - num(i.paid)), 0)),
      invoices: mine.map((i) => ({ id: i.id, number: i.number, status: i.status, net: net(i), total: num(i.total), paid: num(i.paid), dueDate: i.dueDate })),
    };
  });
  const free = invoices.filter((i) => !i.clientPoId && issued(i.status));
  const noPo = { count: free.length, billed: round2(free.reduce((s, i) => s + net(i), 0)), received: round2(free.reduce((s, i) => s + num(i.paid), 0)), leftToCollect: round2(free.reduce((s, i) => s + (num(i.total) - num(i.paid)), 0)) };
  const open = lines.filter((l) => l.po.status !== "CANCELLED");
  return {
    quotations: quotes.map((q) => ({ id: q.id, number: q.number, title: q.title, total: num(q.total), status: q.status, date: q.date })),
    pos: lines,
    noPo,
    totals: {
      poValue: round2(open.reduce((s, l) => s + num(l.po.amount), 0)),
      billed: round2(open.reduce((s, l) => s + l.billed, 0) + noPo.billed),
      received: round2(open.reduce((s, l) => s + l.received, 0) + noPo.received),
      leftToBill: round2(open.filter((l) => l.po.status === "OPEN").reduce((s, l) => s + Math.max(0, l.leftToBill), 0)),
      leftToCollect: round2(open.reduce((s, l) => s + l.leftToCollect, 0) + noPo.leftToCollect),
    },
  };
}

/** What billing a PO already carries (everything not cancelled, drafts included), excluding one invoice being edited. */
export async function billedAgainstPo(poId: string, exceptInvoiceId?: string): Promise<number> {
  const inv = await db.invoice.findMany({ where: { clientPoId: poId, deletedAt: null, status: { in: [...LIVE] }, ...(exceptInvoiceId ? { id: { not: exceptInvoiceId } } : {}) }, select: { subtotal: true, discount: true } });
  return round2(inv.reduce((s, i) => s + net(i), 0));
}

/** Open purchase orders for the invoice form, each with what is still left to bill. */
export async function poOptions(companyId: string): Promise<{ value: string; label: string; clientId: string }[]> {
  const pos = await db.clientPO.findMany({ where: { companyId, status: "OPEN" }, include: { client: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 500 });
  if (!pos.length) return [];
  const inv = await db.invoice.findMany({ where: { clientPoId: { in: pos.map((p) => p.id) }, deletedAt: null, status: { in: [...LIVE] } }, select: { clientPoId: true, subtotal: true, discount: true } });
  return pos.map((p) => {
    const billed = inv.filter((i) => i.clientPoId === p.id).reduce((s, i) => s + net(i), 0);
    return { value: p.id, clientId: p.clientId, label: `PO ${p.number} · ${p.client.name} · ₹${Math.round(num(p.amount) - billed).toLocaleString("en-IN")} left to bill` };
  });
}
