import "server-only";
import type { Ctx } from "./auth";
import { db } from "./db";
import { projectScope } from "./scope";
import { reportDay } from "./site-reports";

/**
 * What is to be done today, from the project schedules: for every project the person is named on (managers and directors: every active
 * project), the tasks that are running today, the ones running late, and the ones that start in the next few days.
 * Days are IST calendar days, the same way tasks and reports are dated.
 */
const DAY = 86400000;
const ACTIVE = ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"] as const;

export type PlanTask = {
  id: string; code: string; name: string; zone: string | null; trade: string | null; people: number | null; status: string; progress: number;
  start: Date | null; due: Date | null; plannedQty: number | null; actualQty: number | null; unit: string | null; blockedReason: string | null;
  waitingFor: string | null; // the task it depends on, when that one is not finished
  day: number | null; of: number | null; // "day 2 of 5" while it is running
  daysLate: number; // only for late tasks
  startsIn: number; // only for coming tasks
};
export type PlanProject = { id: string; code: string; name: string; today: PlanTask[]; late: PlanTask[]; soon: PlanTask[] };

export async function todayPlan(c: Ctx, now: Date = new Date(), horizonDays = 3): Promise<{ day: Date; projects: PlanProject[]; counts: { today: number; late: number; soon: number } }> {
  const day = reportDay(now);
  const projects = await db.project.findMany({ where: { ...projectScope(c), deletedAt: null, status: { in: [...ACTIVE] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  if (!projects.length) return { day, projects: [], counts: { today: 0, late: 0, soon: 0 } };
  const rows = await db.projectTask.findMany({
    where: { companyId: c.companyId, projectId: { in: projects.map((p) => p.id) }, status: { not: "COMPLETED" }, OR: [{ dueDate: { not: null } }, { startDate: { not: null } }] },
    orderBy: [{ dueDate: "asc" }, { startDate: "asc" }, { code: "asc" }], take: 1500,
  });
  const depIds = [...new Set(rows.map((r) => r.dependsOnId).filter((x): x is string => !!x))];
  const deps = depIds.length ? await db.projectTask.findMany({ where: { id: { in: depIds } }, select: { id: true, name: true, status: true } }) : [];
  const dep = new Map(deps.map((d) => [d.id, d]));
  const t0 = day.getTime();
  const out = new Map<string, PlanProject>(projects.map((p) => [p.id, { ...p, today: [], late: [], soon: [] }]));
  const counts = { today: 0, late: 0, soon: 0 };

  for (const r of rows) {
    const s = r.startDate ?? r.dueDate!, e = r.dueDate ?? r.startDate!;
    const d = dep.get(r.dependsOnId ?? "");
    const base: PlanTask = {
      id: r.id, code: r.code, name: r.name, zone: r.zone, trade: r.requiredTrade, people: r.requiredHeadcount, status: r.status, progress: r.progress,
      start: r.startDate, due: r.dueDate, plannedQty: r.plannedQty == null ? null : Number(r.plannedQty), actualQty: r.actualQty == null ? null : Number(r.actualQty), unit: r.qtyUnit,
      blockedReason: r.blockedReason, waitingFor: d && d.status !== "COMPLETED" ? d.name : null, day: null, of: null, daysLate: 0, startsIn: 0,
    };
    const bucket = out.get(r.projectId)!;
    if (e.getTime() < t0) { bucket.late.push({ ...base, daysLate: Math.round((t0 - e.getTime()) / DAY) }); counts.late++; }
    else if (s.getTime() <= t0) { bucket.today.push({ ...base, day: Math.round((t0 - s.getTime()) / DAY) + 1, of: Math.round((e.getTime() - s.getTime()) / DAY) + 1 }); counts.today++; }
    else if (s.getTime() - t0 <= horizonDays * DAY) { bucket.soon.push({ ...base, startsIn: Math.round((s.getTime() - t0) / DAY) }); counts.soon++; }
  }
  for (const p of out.values()) p.late.sort((a, b) => b.daysLate - a.daysLate);
  return { day, projects: [...out.values()].filter((p) => p.today.length + p.late.length + p.soon.length > 0), counts };
}

/** The scheduled work of today as one or two lines of text, to start the morning update with. */
export function planLine(tasks: PlanTask[], max = 420): string {
  const text = tasks.map((t) => `${t.name}${t.zone ? ` (${t.zone})` : ""}`).join("; ");
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
