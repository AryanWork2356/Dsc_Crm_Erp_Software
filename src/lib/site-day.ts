import "server-only";
import { db } from "./db";
import { reportDay } from "./site-reports";

/**
 * What the morning update and evening report start from, so nothing that is already in the app is typed again:
 * the work of the day (from the schedule), the crew planned per trade (from the crew needs, which the schedule makes),
 * and what was already said earlier today.
 */
const DAY = 86400000;

export type DayTask = { id: string; name: string; zone: string | null; trade: string | null; status: string; progress: number; due: Date | null; late: boolean };
export type CrewRow = { trade: string; planned: number; present: number | null };
export type Worker = { name: string; taskId: string | null; work: string | null; inTime: string | null; outTime: string | null };

export async function siteDay(companyId: string, projectId: string, now: Date = new Date()) {
  const today = reportDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  const [labour, lastDay, known] = await Promise.all([
    db.siteLabour.findMany({ where: { companyId, projectId, date: today }, orderBy: { createdAt: "asc" } }),
    db.siteLabour.findFirst({ where: { companyId, projectId, date: { lt: today } }, orderBy: { date: "desc" }, select: { date: true } }),
    db.siteLabour.findMany({ where: { companyId, projectId, date: { gte: new Date(today.getTime() - 60 * DAY) } }, distinct: ["name"], select: { name: true }, orderBy: { name: "asc" }, take: 300 }),
  ]);
  const before = lastDay ? await db.siteLabour.findMany({ where: { companyId, projectId, date: lastDay.date }, orderBy: { createdAt: "asc" } }) : [];
  const asWorker = (l: (typeof labour)[number]): Worker => ({ name: l.name, taskId: l.taskId, work: l.work, inTime: l.inTime, outTime: l.outTime });
  const [tasks, needs, logs, morning] = await Promise.all([
    db.projectTask.findMany({ where: { companyId, projectId, status: { not: "COMPLETED" }, OR: [{ startDate: { lte: tomorrow } }, { dueDate: { lte: tomorrow } }] }, orderBy: [{ startDate: "asc" }, { code: "asc" }], take: 60 }),
    db.resourceNeed.findMany({ where: { companyId, projectId, fromDate: { lte: today }, toDate: { gte: today } } }),
    db.manpowerLog.findMany({ where: { companyId, projectId, date: today } }),
    db.dailyReport.findUnique({ where: { projectId_reportDate_kind: { projectId, reportDate: today, kind: "MORNING" } }, select: { manpower: true } }),
  ]);
  const startOf = (t: (typeof tasks)[number]) => (t.startDate ?? t.dueDate)!;
  const endOf = (t: (typeof tasks)[number]) => (t.dueDate ?? t.startDate)!;
  const asTask = (t: (typeof tasks)[number]): DayTask => ({ id: t.id, name: t.name, zone: t.zone, trade: t.requiredTrade, status: t.status, progress: t.progress, due: t.dueDate, late: endOf(t).getTime() < today.getTime() });
  const todayTasks = tasks.filter((t) => startOf(t).getTime() <= today.getTime()).map(asTask);
  const tomorrowTasks = tasks.filter((t) => startOf(t).getTime() === tomorrow.getTime() || (startOf(t).getTime() < tomorrow.getTime() && endOf(t).getTime() >= tomorrow.getTime())).map(asTask);

  // crew planned per trade today: the crew needs (made from the schedule, or added on the Manpower page)
  const plan = new Map<string, number>();
  for (const n of needs) plan.set(n.trade, (plan.get(n.trade) ?? 0) + n.required);
  if (!needs.length) for (const t of tasks) if (t.requiredTrade && t.requiredHeadcount && startOf(t) <= today && endOf(t) >= today) plan.set(t.requiredTrade, (plan.get(t.requiredTrade) ?? 0) + t.requiredHeadcount);
  for (const l of logs) if (!plan.has(l.trade)) plan.set(l.trade, l.planned);
  const crew: CrewRow[] = [...plan.entries()].map(([trade, planned]) => ({ trade, planned, present: logs.find((l) => l.trade.toLowerCase() === trade.toLowerCase())?.present ?? null })).sort((a, b) => b.planned - a.planned);
  return {
    today, todayTasks, tomorrowTasks, crew, morningManpower: morning?.manpower ?? null,
    workers: labour.map(asWorker), // already on today's list (from the morning update)
    lastWorkers: before.map((l) => ({ ...asWorker(l), inTime: null, outTime: null })), // the last working day's people, to copy
    knownNames: known.map((k) => k.name), // names used on this site lately, offered while typing
  };
}

/** The work of the day as one or two lines, to start the plan with. */
export function workLine(tasks: DayTask[], max = 420): string {
  const text = tasks.map((t) => `${t.name}${t.zone ? ` (${t.zone})` : ""}`).join("; ");
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
