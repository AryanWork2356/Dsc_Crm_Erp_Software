import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runDailyAutomations } from "@/lib/automation";
import { runReportReminders } from "@/lib/site-report-reminders";
import { runTimeLimitReminders } from "@/lib/time-limits";
import { syncResourceShortages } from "@/lib/resources";
import { syncDeliveryRisks } from "@/lib/delivery-risk";
import { syncMaterialNeeds } from "@/lib/material-needs";
import { runWeeklyDigest } from "@/lib/director-reports";

/**
 * Scheduler hook – called once a day (7:00 IST) by Vercel Cron (see vercel.json) or any scheduler:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/daily
 * Disabled unless CRON_SECRET is set.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = !!secret && secret.length >= 16 && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return new Response("Unauthorized", { status: 401 });
  const companies = await db.company.findMany({ select: { id: true } });
  const results: Record<string, unknown> = {};
  for (const c of companies) results[c.id] = { ...(await runDailyAutomations(c.id)), siteReportReminders: (await runReportReminders(c.id)).sent, crewShortages: (await syncResourceShortages(c.id)).raised, lateDeliveries: (await syncDeliveryRisks(c.id)).raised, materialNeeds: (await syncMaterialNeeds(c.id)).raised, overdueItems: (await runTimeLimitReminders(c.id)).overdue, weeklyDigestSent: (await runWeeklyDigest(c.id)).sent };
  return Response.json({ ok: true, results });
}

// Vercel's scheduler calls with GET (and sends the CRON_SECRET as a bearer token); other schedulers may use POST.
export const GET = handle;
export const POST = handle;
