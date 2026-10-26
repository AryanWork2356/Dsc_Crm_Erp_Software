import "server-only";
import { db } from "./db";
import { raiseAction, resolveActionsFor } from "./action-items";
import { calendarDay } from "./utils";

/**
 * Manpower planning by project, trade and date: how many people are needed, how many are confirmed, how many actually came.
 * Shortages create ONE action each (owner: the resource coordinator, else the project manager) and close themselves when fixed.
 */

export const TRADES = ["Carpenter", "Electrician", "Plumber", "Painter", "Mason", "Tile layer", "False ceiling", "Polisher", "Fabricator", "Helper"];
/** A shortage is raised this many days before the work starts (or at once if it has started). */
export const LOOKAHEAD_DAYS = 3;
/** A vendor needs at least this many logged days before a reliability figure is shown. */
export const MIN_DAYS_FOR_SCORE = 5;

const DAY = 86400000;
const endOfDay = (d: Date) => new Date(d.getTime() + DAY - 60000);

/** Who is told first about a shortage on a project: the named coordinator, else the project manager, else a director. */
export async function coordinatorFor(companyId: string, projectId: string): Promise<string | null> {
  const s = await db.companySettings.findUnique({ where: { companyId }, select: { resourceCoordinatorId: true } });
  if (s?.resourceCoordinatorId) {
    const u = await db.user.findFirst({ where: { id: s.resourceCoordinatorId, companyId, isActive: true, deletedAt: null }, select: { id: true } });
    if (u) return u.id;
  }
  const p = await db.project.findFirst({ where: { id: projectId, companyId }, select: { projectManagerId: true } });
  if (p?.projectManagerId) return p.projectManagerId;
  const d = await db.user.findFirst({ where: { companyId, role: { in: ["MANAGEMENT", "OWNER"] }, isActive: true, deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } });
  return d?.id ?? null;
}

export type BoardRow = {
  id: string;
  projectId: string;
  projectLabel: string;
  trade: string;
  fromDate: Date;
  toDate: Date;
  required: number;
  confirmed: number;
  gap: number; // required - confirmed (0 when covered)
  vendorId: string | null;
  backupVendorId: string | null;
  plannedToday: number | null;
  presentToday: number | null;
  lateToday: number | null;
  status: "SHORT" | "COVERED" | "OVERCOMMITTED";
  note: string | null;
  confirmedNote: string | null;
};

/** Needs that overlap [from, to]. `projectIds` limits what the viewer may see (null = everything). */
export async function resourceBoard(companyId: string, projectIds: string[] | null, from: Date, to: Date, today: Date = calendarDay()): Promise<BoardRow[]> {
  const needs = await db.resourceNeed.findMany({
    where: { companyId, fromDate: { lte: to }, toDate: { gte: from }, ...(projectIds ? { projectId: { in: projectIds } } : {}) },
    include: { project: { select: { code: true, name: true } } },
    orderBy: [{ fromDate: "asc" }, { trade: "asc" }],
    take: 500,
  });
  const logs = await db.manpowerLog.findMany({ where: { companyId, date: today, projectId: { in: [...new Set(needs.map((n) => n.projectId))] } } });
  const vendorIds = [...new Set(needs.map((n) => n.vendorId).filter((v): v is string => !!v))];
  const vendors = vendorIds.length ? await db.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, crewSize: true } }) : [];
  const crew = new Map(vendors.map((v) => [v.id, v.crewSize]));
  // everything a vendor has confirmed over the same dates, across all projects
  const sameVendor = vendorIds.length ? await db.resourceNeed.findMany({ where: { companyId, vendorId: { in: vendorIds }, fromDate: { lte: to }, toDate: { gte: from } }, select: { id: true, vendorId: true, confirmed: true, fromDate: true, toDate: true } }) : [];

  return needs.map((n) => {
    const log = logs.find((l) => l.projectId === n.projectId && l.trade.toLowerCase() === n.trade.toLowerCase());
    const cap = n.vendorId ? crew.get(n.vendorId) : null;
    const overlapping = n.vendorId ? sameVendor.filter((o) => o.vendorId === n.vendorId && o.fromDate <= n.toDate && o.toDate >= n.fromDate).reduce((s, o) => s + o.confirmed, 0) : 0;
    const gap = Math.max(0, n.required - n.confirmed);
    return {
      id: n.id, projectId: n.projectId, projectLabel: `${n.project.code} · ${n.project.name}`, trade: n.trade, fromDate: n.fromDate, toDate: n.toDate,
      required: n.required, confirmed: n.confirmed, gap, vendorId: n.vendorId, backupVendorId: n.backupVendorId,
      plannedToday: log ? log.planned : null, presentToday: log ? log.present : null, lateToday: log ? log.late : null,
      status: gap > 0 ? "SHORT" : cap && overlapping > cap ? "OVERCOMMITTED" : "COVERED", note: n.note, confirmedNote: n.confirmedNote,
    };
  });
}

/**
 * Raises one action for each need that is still short and starts within the look-ahead window (or has started);
 * closes the action once the need is covered or over. Safe to run any number of times.
 */
export async function syncResourceShortages(companyId: string, now: Date = new Date()): Promise<{ raised: number; closed: number }> {
  const today = calendarDay(now);
  const horizon = new Date(today.getTime() + LOOKAHEAD_DAYS * DAY);
  const needs = await db.resourceNeed.findMany({ where: { companyId, toDate: { gte: today } }, include: { project: { select: { code: true, name: true } } }, take: 1000 });
  let raised = 0;
  let closed = 0;
  for (const n of needs) {
    const short = n.confirmed < n.required;
    const due = n.fromDate <= horizon;
    if (short && due) {
      const owner = await coordinatorFor(companyId, n.projectId);
      if (!owner) continue;
      const started = n.fromDate <= today;
      const gap = n.required - n.confirmed;
      const severity = started || gap * 2 >= n.required ? "HIGH" : "MEDIUM";
      const dueDate = started ? endOfDay(today) : endOfDay(new Date(Math.max(today.getTime(), n.fromDate.getTime() - DAY)));
      const r = await raiseAction(db, {
        companyId, title: `${n.project.code}: ${gap} ${n.trade.toLowerCase()}${gap === 1 ? "" : "s"} still not confirmed`, severity, ownerId: owner, createdById: owner, projectId: n.projectId, dueDate,
        detail: `Needed ${n.required} from ${n.fromDate.toISOString().slice(0, 10)}; ${n.confirmed} confirmed. Confirm the vendor's headcount or call the backup.`,
        sourceType: "ResourceNeed", sourceId: n.id, sourceLabel: `${n.trade} need`, link: "/resources",
      });
      if (r.created) raised++;
    } else if (!short) {
      const open = await db.actionItem.count({ where: { companyId, sourceType: "ResourceNeed", sourceId: n.id, status: { in: ["OPEN", "IN_PROGRESS"] } } });
      if (open) { await resolveActionsFor(db, companyId, "ResourceNeed", n.id, n.createdById, "The confirmed headcount now covers the need."); closed++; }
    }
  }
  return { raised, closed };
}

export type VendorScore = { vendorId: string; days: number; planned: number; present: number; late: number; attendancePct: number | null; punctualityPct: number | null; enough: boolean };

/** Reliability from what really happened: people present ÷ people planned, and people on time ÷ people present. */
export async function vendorScores(companyId: string, vendorIds?: string[], sinceDays = 90, now: Date = new Date()): Promise<Map<string, VendorScore>> {
  const since = new Date(calendarDay(now).getTime() - sinceDays * DAY);
  const logs = await db.manpowerLog.findMany({ where: { companyId, vendorId: vendorIds ? { in: vendorIds } : { not: null }, date: { gte: since } }, select: { vendorId: true, date: true, planned: true, present: true, late: true } });
  const out = new Map<string, VendorScore>();
  for (const l of logs) {
    const v = l.vendorId!;
    const s = out.get(v) ?? { vendorId: v, days: 0, planned: 0, present: 0, late: 0, attendancePct: null, punctualityPct: null, enough: false };
    s.days++; s.planned += l.planned; s.present += l.present; s.late += l.late;
    out.set(v, s);
  }
  for (const s of out.values()) {
    s.enough = s.days >= MIN_DAYS_FOR_SCORE;
    s.attendancePct = s.planned > 0 ? Math.min(100, Math.round((s.present / s.planned) * 100)) : null;
    s.punctualityPct = s.present > 0 ? Math.max(0, Math.round(((s.present - s.late) / s.present) * 100)) : null;
  }
  return out;
}

/** Severity of a short day: nobody came = critical; half or more missing = high; otherwise medium. */
export function shortDaySeverity(planned: number, present: number): "CRITICAL" | "HIGH" | "MEDIUM" {
  if (present <= 0) return "CRITICAL";
  return (planned - present) * 2 >= planned ? "HIGH" : "MEDIUM";
}
