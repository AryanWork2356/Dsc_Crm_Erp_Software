import "server-only";
import type { ReportKind } from "@prisma/client";
import { db } from "./db";
import { notifyRoles, notifyUsers } from "./notify";
import { DEFAULT_TIMES, dueLabel, istParts, minutesLate, reportDay, type ReportTimes } from "./site-reports";

const LIVE_STATUSES = ["EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"] as const;
export const PM_ESCALATE_AFTER_MIN = 60;
export const MGMT_ESCALATE_AFTER_MIN = 180;

export async function reportTimes(companyId: string): Promise<ReportTimes> {
  const s = await db.companySettings.findUnique({ where: { companyId }, select: { reportMorningDue: true, reportMorningDueOutstation: true, reportEveningDue: true } });
  return s ?? DEFAULT_TIMES;
}

/**
 * Chases missing site reports (SOP: supervisor reports are mandatory and delays escalate up the chain):
 *   past the deadline  → supervisor
 *   +1 hour            → project manager
 *   +3 hours           → management / owner
 * Idempotent (dedupeKey per project/day/kind/person) so it can run on every page load or from cron.
 */
export async function runReportReminders(companyId: string, now: Date = new Date()): Promise<{ sent: number }> {
  const t = await reportTimes(companyId);
  const day = reportDay(now);
  const dateKey = istParts(now).date;
  const projects = await db.project.findMany({
    where: { companyId, deletedAt: null, status: { in: [...LIVE_STATUSES] } },
    select: { id: true, code: true, name: true, outstation: true, supervisorId: true, siteEngineerId: true, projectManagerId: true, dailyReports: { where: { reportDate: day }, select: { kind: true } } },
  });
  let sent = 0;
  for (const p of projects) {
    for (const kind of ["MORNING", "EVENING"] as ReportKind[]) {
      if (p.dailyReports.some((r) => r.kind === kind)) continue;
      const late = minutesLate(kind, p.outstation, now, t);
      if (late <= 0) continue;
      const what = kind === "MORNING" ? "morning update" : "evening report";
      const link = `/site-reports/new?project=${p.id}&kind=${kind}`;
      const key = (who: string) => `rep:${p.id}:${dateKey}:${kind}:${who}`;
      const field = [p.supervisorId, p.siteEngineerId].filter(Boolean) as string[];
      if (field.length) {
        await notifyUsers(field, { companyId, type: "REPORT_MISSING", title: `${p.code}: ${what} not sent`, body: `It was due at ${dueLabel(kind, p.outstation, t)}. Please send it now.`, link, dedupeKey: key("field") });
        sent += field.length;
      }
      if (late >= PM_ESCALATE_AFTER_MIN && p.projectManagerId) {
        await notifyUsers([p.projectManagerId], { companyId, type: "REPORT_MISSING", title: `${p.code} – ${p.name}: ${what} missing`, body: `Site team hasn't sent it (due ${dueLabel(kind, p.outstation, t)}).`, link: "/site-reports", dedupeKey: key("pm") });
        sent += 1;
      }
      if (late >= MGMT_ESCALATE_AFTER_MIN) {
        await notifyRoles(companyId, ["OWNER", "MANAGEMENT"], { type: "REPORT_MISSING", title: `${p.code} – ${p.name}: ${what} still missing`, body: `More than ${MGMT_ESCALATE_AFTER_MIN / 60} hours late.`, link: "/site-reports", dedupeKey: key("mgmt") });
        sent += 1;
      }
    }
  }
  return { sent };
}
