import "server-only";
import { db } from "./db";
import { reportDay } from "./site-reports";
import { num } from "./utils";

/**
 * The day-by-day schedule of ONE project: for every day from Day 1 to the last day, the work planned for it, the billing stages that fall
 * on it, and how many people each trade needs. It is put together from the project's tasks and milestones, so changing a date there moves
 * it here. Material is NOT part of the schedule: it has its own list (see material-needs.ts).
 */
const DAY = 86400000;
export const MAX_SCHEDULE_DAYS = 150;

export type DayWork = { id: string; name: string; zone: string | null; trade: string | null; people: number | null; status: string; progress: number; day: number; of: number; late: boolean; done: boolean };
export type DayMilestone = { id: string; name: string; billingPct: number; done: boolean };
export type ScheduleDay = { date: Date; dayNo: number; isToday: boolean; isPast: boolean; isSunday: boolean; work: DayWork[]; milestones: DayMilestone[]; people: { trade: string; count: number }[] };
export type ProjectSchedule = { today: Date; start: Date | null; end: Date | null; truncated: boolean; days: ScheduleDay[]; counts: { work: number; done: number; late: number } };

export async function projectSchedule(companyId: string, projectId: string, now: Date = new Date()): Promise<ProjectSchedule> {
  const today = reportDay(now);
  const empty: ProjectSchedule = { today, start: null, end: null, truncated: false, days: [], counts: { work: 0, done: 0, late: 0 } };
  const p = await db.project.findFirst({ where: { id: projectId, companyId }, select: { startDate: true, plannedEndDate: true } });
  if (!p) return empty;
  const [tasks, milestones] = await Promise.all([
    db.projectTask.findMany({ where: { companyId, projectId, OR: [{ startDate: { not: null } }, { dueDate: { not: null } }] }, orderBy: [{ startDate: "asc" }, { code: "asc" }] }),
    db.projectMilestone.findMany({ where: { projectId, dueDate: { not: null } }, orderBy: { dueDate: "asc" } }),
  ]);
  if (!tasks.length) return empty;
  const edges = [p.startDate, ...tasks.flatMap((t) => [t.startDate, t.dueDate]), ...milestones.map((m) => m.dueDate)].filter((d): d is Date => !!d).map((d) => d.getTime());
  const first = p.startDate?.getTime() ?? Math.min(...edges);
  const lo = Math.min(first, ...edges), hi = Math.max(...edges);
  const n = Math.min(Math.round((hi - lo) / DAY) + 1, MAX_SCHEDULE_DAYS);
  const truncated = Math.round((hi - lo) / DAY) + 1 > MAX_SCHEDULE_DAYS;
  const key = (d: Date) => Math.round((d.getTime() - lo) / DAY);

  const days: ScheduleDay[] = Array.from({ length: n }, (_, i) => {
    const date = new Date(lo + i * DAY);
    return { date, dayNo: Math.round((date.getTime() - first) / DAY) + 1, isToday: date.getTime() === today.getTime(), isPast: date.getTime() < today.getTime(), isSunday: date.getUTCDay() === 0, work: [], milestones: [], people: [] };
  });
  for (const t of tasks) {
    const s = key((t.startDate ?? t.dueDate)!), e = key((t.dueDate ?? t.startDate)!);
    const done = t.status === "COMPLETED";
    for (let k = Math.max(s, 0); k <= Math.min(e, n - 1); k++) {
      days[k].work.push({ id: t.id, name: t.name, zone: t.zone, trade: t.requiredTrade, people: t.requiredHeadcount, status: t.status, progress: t.progress, day: k - s + 1, of: e - s + 1, done, late: !done && e < key(today) });
    }
  }
  for (const m of milestones) {
    const k = key(m.dueDate!);
    if (k >= 0 && k < n) days[k].milestones.push({ id: m.id, name: m.name, billingPct: num(m.billingPct), done: !!m.completedAt });
  }
  for (const d of days) {
    const by = new Map<string, number>();
    for (const w of d.work) if (w.people && !w.done) by.set(w.trade || "Other", (by.get(w.trade || "Other") ?? 0) + w.people);
    d.people = [...by.entries()].map(([trade, count]) => ({ trade, count })).sort((a, b) => b.count - a.count);
  }
  const late = tasks.filter((t) => t.status !== "COMPLETED" && (t.dueDate ?? t.startDate)!.getTime() < today.getTime()).length;
  return { today, start: new Date(first), end: new Date(hi), truncated, days, counts: { work: tasks.length, done: tasks.filter((t) => t.status === "COMPLETED").length, late } };
}
