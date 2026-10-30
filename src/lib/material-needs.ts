import "server-only";
import { db } from "./db";
import { raiseAction, resolveActionsFor } from "./action-items";
import { notifyUsers } from "./notify";
import { num } from "./utils";
import { reportDay } from "./site-reports";

/**
 * Materials the project schedule needs, and where each one stands. Nobody types the "where it stands": it is worked out from the purchase
 * requests, purchase orders and receipts the team already enters.
 *
 *   NOT_ASKED     nothing has been requested or ordered for it
 *   PART_ASKED    only part of the quantity has been requested or ordered
 *   REQUESTED     a purchase request (or an order waiting for approval) covers it, but there is no confirmed order yet
 *   ORDERED       an order has been placed for all of it, nothing has arrived
 *   PART_ARRIVED  some of it has arrived on site
 *   ARRIVED       all of it has arrived
 *
 * A line that is not on its way in time raises ONE action for Procurement (and tells the project manager), and the action closes by
 * itself when the material arrives or the dates are fixed. The same stock is never counted for two needs: the earliest need is served first.
 */
const DAY = 86400000;

export type NeedStatus = "NOT_ASKED" | "PART_ASKED" | "REQUESTED" | "ORDERED" | "PART_ARRIVED" | "ARRIVED";
export const NEED_LABEL: Record<NeedStatus, string> = { NOT_ASKED: "Not asked yet", PART_ASKED: "Only part asked", REQUESTED: "Requested, not ordered", ORDERED: "Ordered", PART_ARRIVED: "Part arrived", ARRIVED: "Arrived" };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** The same material, whether it was picked from the list or typed: same list entry, same name, or one name inside the other (6+ letters). */
export function sameMaterial(a: { materialId?: string | null; description: string }, b: { materialId?: string | null; description: string }): boolean {
  if (a.materialId && b.materialId) return a.materialId === b.materialId;
  const x = norm(a.description), y = norm(b.description);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)));
}

export type NeedIn = { id: string; materialId?: string | null; description: string; quantity: number; neededBy: Date };
/** `arrived` = received on an order, `open` = ordered and still to come (with the supplier's promise), `asked` = requested but not ordered. */
export type SupplyIn = { materialId?: string | null; description: string; kind: "arrived" | "open" | "asked"; quantity: number; eta?: Date | null };
export type NeedOut = { id: string; status: NeedStatus; arrived: number; ordered: number; asked: number; eta: Date | null };

/** Gives each need its share of the supply, earliest need first, and says where it stands. Pure: no database. */
export function allocateNeeds(needs: NeedIn[], supply: SupplyIn[]): Map<string, NeedOut> {
  const left = supply.map((s) => ({ ...s, left: s.quantity }));
  const out = new Map<string, NeedOut>();
  for (const n of [...needs].sort((a, b) => a.neededBy.getTime() - b.neededBy.getTime())) {
    const take = (kind: SupplyIn["kind"], want: number) => {
      let got = 0, eta: Date | null = null;
      for (const s of left) {
        if (got >= want) break;
        if (s.kind !== kind || s.left <= 0 || !sameMaterial(n, s)) continue;
        const t = Math.min(s.left, want - got);
        s.left -= t; got += t;
        if (s.eta && (!eta || s.eta > eta)) eta = s.eta;
      }
      return { got, eta };
    };
    const a = take("arrived", n.quantity);
    const o = take("open", n.quantity - a.got);
    const r = take("asked", n.quantity - a.got - o.got);
    const covered = a.got + o.got + r.got;
    const eps = 1e-6;
    const status: NeedStatus = a.got + eps >= n.quantity ? "ARRIVED" : a.got > 0 ? "PART_ARRIVED" : o.got + eps >= n.quantity ? "ORDERED" : covered + eps >= n.quantity ? "REQUESTED" : covered > 0 ? "PART_ASKED" : "NOT_ASKED";
    out.set(n.id, { id: n.id, status, arrived: a.got, ordered: o.got, asked: r.got, eta: o.eta });
  }
  return out;
}

export type Problem = { kind: "LATE" | "NOT_ARRIVED" | "TOO_LATE" | "NOT_ASKED" | "NOT_ORDERED"; severity: "HIGH" | "MEDIUM"; text: string };
const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Is this line in trouble today? `warnDays` = how many days before the need date to start warning about material nobody has asked for. */
export function problemOf(status: NeedStatus, neededBy: Date, eta: Date | null, today: Date, warnDays: number): Problem | null {
  if (status === "ARRIVED") return null;
  const days = Math.round((neededBy.getTime() - today.getTime()) / DAY);
  if (days < 0) return { kind: "LATE", severity: "HIGH", text: `Needed on ${fmt(neededBy)}, ${-days} day${days === -1 ? "" : "s"} ago, and not all of it has arrived` };
  if (status === "NOT_ASKED" || status === "PART_ASKED") return days <= warnDays ? { kind: "NOT_ASKED", severity: days <= 2 ? "HIGH" : "MEDIUM", text: `${status === "NOT_ASKED" ? "Not asked for yet" : "Only part has been asked for"}: needed ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`} (${fmt(neededBy)})` } : null;
  if (status === "REQUESTED") return days <= Math.min(warnDays, 3) ? { kind: "NOT_ORDERED", severity: days <= 1 ? "HIGH" : "MEDIUM", text: `Requested but not ordered: needed ${days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`} (${fmt(neededBy)})` } : null;
  // ordered, or part arrived
  if (days <= 1) return { kind: "NOT_ARRIVED", severity: "HIGH", text: `Needed ${days === 0 ? "today" : "tomorrow"} and not all of it has arrived${eta ? ` (supplier promised ${fmt(eta)})` : ""}` };
  if (eta && eta.getTime() > neededBy.getTime() && days <= warnDays) return { kind: "TOO_LATE", severity: "MEDIUM", text: `The supplier promised ${fmt(eta)} but it is needed on ${fmt(neededBy)}` };
  return null;
}

export type NeedRow = {
  id: string; projectId: string; projectCode: string; projectName: string; managerId: string | null; supervisorId: string | null; materialId: string | null; description: string; unit: string; quantity: number; neededBy: Date; taskId: string | null; forWork: string | null; note: string | null;
  status: NeedStatus; arrived: number; ordered: number; asked: number; eta: Date | null; problem: Problem | null; days: number;
};

/** Every need of the given projects (null = all), with where it stands today. */
export async function needBoard(companyId: string, projectIds: string[] | null, now: Date = new Date()): Promise<NeedRow[]> {
  const today = reportDay(now);
  const settings = await db.companySettings.findUnique({ where: { companyId }, select: { materialWarnDays: true } });
  const warn = settings?.materialWarnDays ?? 7;
  const needs = await db.materialNeed.findMany({ where: { companyId, project: { deletedAt: null }, ...(projectIds ? { projectId: { in: projectIds } } : {}) }, include: { project: { select: { code: true, name: true, status: true, projectManagerId: true, supervisorId: true } } }, orderBy: [{ neededBy: "asc" }, { description: "asc" }], take: 3000 });
  const live = needs.filter((n) => !["COMPLETED", "CANCELLED"].includes(n.project.status));
  const ids = [...new Set(live.map((n) => n.projectId))];
  const [prs, pos] = ids.length ? await Promise.all([
    db.purchaseRequest.findMany({ where: { companyId, projectId: { in: ids }, status: { in: ["PENDING_APPROVAL", "APPROVED"] } }, select: { projectId: true, items: { select: { materialId: true, description: true, quantity: true } } } }),
    db.purchaseOrder.findMany({ where: { companyId, projectId: { in: ids }, status: { notIn: ["DRAFT", "CANCELLED"] } }, select: { projectId: true, status: true, deliveryDate: true, items: { select: { materialId: true, description: true, quantity: true, receivedQty: true, promisedEta: true, needBy: true } } } }),
  ]) : [[], []];
  const rows: NeedRow[] = [];
  for (const pid of ids) {
    const mine = live.filter((n) => n.projectId === pid);
    const supply: SupplyIn[] = [];
    for (const r of prs.filter((x) => x.projectId === pid)) for (const i of r.items) supply.push({ materialId: i.materialId, description: i.description, kind: "asked", quantity: num(i.quantity) });
    for (const po of pos.filter((x) => x.projectId === pid)) for (const i of po.items) {
      const recv = Math.min(num(i.receivedQty), num(i.quantity)), rest = num(i.quantity) - recv;
      if (recv > 0) supply.push({ materialId: i.materialId, description: i.description, kind: "arrived", quantity: recv });
      if (rest > 0) supply.push({ materialId: i.materialId, description: i.description, kind: po.status === "PENDING_APPROVAL" ? "asked" : "open", quantity: rest, eta: i.promisedEta ?? i.needBy ?? po.deliveryDate });
    }
    const got = allocateNeeds(mine.map((n) => ({ id: n.id, materialId: n.materialId, description: n.description, quantity: num(n.quantity), neededBy: n.neededBy })), supply);
    for (const n of mine) {
      const g = got.get(n.id)!;
      rows.push({ id: n.id, projectId: n.projectId, projectCode: n.project.code, projectName: n.project.name, managerId: n.project.projectManagerId, supervisorId: n.project.supervisorId, materialId: n.materialId, description: n.description, unit: n.unit, quantity: num(n.quantity), neededBy: n.neededBy, taskId: n.taskId, forWork: n.forWork, note: n.note,
        status: g.status, arrived: g.arrived, ordered: g.ordered, asked: g.asked, eta: g.eta, problem: problemOf(g.status, n.neededBy, g.eta, today, warn), days: Math.round((n.neededBy.getTime() - today.getTime()) / DAY) });
    }
  }
  return rows.sort((a, b) => a.neededBy.getTime() - b.neededBy.getTime() || a.description.localeCompare(b.description));
}

/** One action per line in trouble, for Procurement; closes it when the line is fine again. Safe to repeat. */
export async function syncMaterialNeeds(companyId: string, now: Date = new Date()): Promise<{ raised: number; closed: number }> {
  const rows = await needBoard(companyId, null, now);
  const procurement = await db.user.findFirst({ where: { companyId, role: "PROCUREMENT", isActive: true, deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
  const fallback = procurement ?? (await db.user.findFirst({ where: { companyId, role: { in: ["MANAGEMENT", "OWNER"] }, isActive: true, deletedAt: null }, select: { id: true } }));
  let raised = 0, closed = 0;
  const today = reportDay(now);
  const troubled = new Set<string>();
  for (const r of rows) {
    if (!r.problem) continue;
    troubled.add(r.id);
    const owner = fallback?.id ?? r.managerId;
    if (!owner) continue;
    const detail = `${r.problem.text}. ${r.forWork ? `Needed for: ${r.forWork}. ` : ""}Asked ${r.asked + r.ordered + r.arrived} of ${r.quantity}, arrived ${r.arrived}.`;
    const dueDate = r.problem.kind === "LATE" || r.problem.kind === "NOT_ARRIVED" ? new Date(today.getTime() + DAY - 60000) : new Date(Math.max(today.getTime(), Math.min(r.neededBy.getTime() - DAY, today.getTime() + 2 * DAY)));
    const title = `Material: ${r.quantity} ${r.unit} ${r.description} for ${r.projectCode}`;
    const res = await raiseAction(db, {
      companyId, ownerId: owner, createdById: owner, projectId: r.projectId, severity: r.problem.severity, title, detail, dueDate,
      sourceType: "MaterialNeed", sourceId: r.id, sourceLabel: `${r.projectCode} material`, link: `/projects/${r.projectId}?tab=materials`,
    });
    const changed = !res.created && res.action.detail !== detail;
    // the same line whose trouble changed (for example "not asked" became "requested, not ordered"): keep ONE action, with today's words
    if (changed) await db.actionItem.update({ where: { id: res.action.id }, data: { title, detail, severity: r.problem.severity, dueDate } });
    if (res.created) raised++;
    if (res.created || changed) {
      // the project manager hears of it; the supervisor too once the site is waiting. Each kind of trouble is told once.
      const tell = [r.managerId, r.problem.kind === "LATE" || r.problem.kind === "NOT_ARRIVED" ? r.supervisorId : null].filter((x): x is string => !!x && x !== owner);
      if (tell.length) await notifyUsers(tell, { companyId, type: "GENERAL", title: `Material: ${r.description} (${r.projectCode})`, body: r.problem.text, link: `/projects/${r.projectId}?tab=materials`, dedupeKey: `matneed:${r.id}:${r.problem.kind}` });
    }
  }
  const open = await db.actionItem.findMany({ where: { companyId, sourceType: "MaterialNeed", status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { sourceId: true, createdById: true } });
  for (const a of open) if (a.sourceId && !troubled.has(a.sourceId)) { await resolveActionsFor(db, companyId, "MaterialNeed", a.sourceId, a.createdById, "The material arrived, was ordered, or its date was corrected."); closed++; }
  return { raised, closed };
}
