import "server-only";
import { db } from "./db";
import { notifyUsers } from "./notify";
import { istParts, reportDay } from "./site-reports";

/**
 * Every morning (from 6:30 IST, once a day): each person on a live site gets that site's work of the day from the schedule:
 * the supervisor, the site engineer, the project manager, and whoever a job is assigned to. It also reaches their phone if
 * they turned phone alerts on. Safe to run many times: one message per person, site and day.
 */
const LIVE = ["EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"] as const;
export const MORNING_PLAN_FROM_MIN = 6 * 60 + 30;

export async function sendMorningPlans(companyId: string, now: Date = new Date()): Promise<{ sent: number }> {
  if (istParts(now).minutes < MORNING_PLAN_FROM_MIN) return { sent: 0 };
  const today = reportDay(now), date = istParts(now).date;
  const projects = await db.project.findMany({ where: { companyId, deletedAt: null, status: { in: [...LIVE] } }, select: { id: true, code: true, name: true, supervisorId: true, siteEngineerId: true, projectManagerId: true } });
  if (!projects.length) return { sent: 0 };
  const tasks = await db.projectTask.findMany({
    where: { companyId, projectId: { in: projects.map((p) => p.id) }, status: { not: "COMPLETED" }, OR: [{ startDate: { lte: today } }, { dueDate: { lte: today } }] },
    select: { projectId: true, name: true, zone: true, requiredTrade: true, requiredHeadcount: true, startDate: true, dueDate: true, assignedToId: true }, orderBy: [{ startDate: "asc" }],
  });
  let sent = 0;
  for (const p of projects) {
    const mine = tasks.filter((t) => t.projectId === p.id);
    if (!mine.length) continue;
    const late = mine.filter((t) => (t.dueDate ?? t.startDate)!.getTime() < today.getTime());
    const running = mine.filter((t) => !late.includes(t));
    const people = new Map<string, number>();
    for (const t of running) if (t.requiredTrade && t.requiredHeadcount) people.set(t.requiredTrade, (people.get(t.requiredTrade) ?? 0) + t.requiredHeadcount);
    const lines = running.slice(0, 6).map((t) => `• ${t.name}${t.zone ? ` (${t.zone})` : ""}`);
    if (running.length > 6) lines.push(`• and ${running.length - 6} more`);
    const body = [
      ...lines,
      late.length ? `Running late: ${late.length} job${late.length === 1 ? "" : "s"}` : null,
      people.size ? `Crew: ${[...people.entries()].map(([t, n]) => `${n} ${t}`).join(", ")}` : null,
      "Send the morning update: your selfie at the site and a site photo.",
    ].filter(Boolean).join("\n");
    const who = [p.supervisorId, p.siteEngineerId, p.projectManagerId, ...mine.map((t) => t.assignedToId)].filter((x): x is string => !!x);
    const before = await db.notification.count({ where: { dedupeKey: `plan:${p.id}:${date}` } });
    await notifyUsers(who, { companyId, type: "GENERAL", title: `Today at ${p.code}: ${running.length} job${running.length === 1 ? "" : "s"}${late.length ? `, ${late.length} late` : ""}`, body, link: "/today", dedupeKey: `plan:${p.id}:${date}` });
    sent += (await db.notification.count({ where: { dedupeKey: `plan:${p.id}:${date}` } })) - before;
  }
  return { sent };
}

