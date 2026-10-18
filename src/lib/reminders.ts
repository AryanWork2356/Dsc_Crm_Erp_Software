import "server-only";
import { runReportReminders } from "./site-report-reminders";
import { runTimeLimitReminders } from "./time-limits";
import { runWeeklyDigest } from "./director-reports";

const MIN_GAP_MS = 5 * 60 * 1000;
const lastRun = new Map<string, number>();

/**
 * Runs the "chase missing reports" and "time limit" reminders, at most once every 5 minutes per company, triggered by
 * whoever opens a busy page. Never throws (a failed reminder must not break the page). A fixed-time scheduler can call
 * POST /api/cron/daily as well – the reminders de-duplicate, so repeats are harmless.
 */
export async function maybeRunReminders(companyId: string, now: Date = new Date()) {
  const last = lastRun.get(companyId) ?? 0;
  if (now.getTime() - last < MIN_GAP_MS) return;
  lastRun.set(companyId, now.getTime());
  try {
    await runReportReminders(companyId, now);
    await runTimeLimitReminders(companyId, now);
    await runWeeklyDigest(companyId, now);
  } catch (e) {
    console.error("reminders failed", e);
  }
}
