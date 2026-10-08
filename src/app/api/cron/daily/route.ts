import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { runDailyAutomations } from "@/lib/automation";

/**
 * Scheduler hook – call once a day (e.g. 7:00 IST) from cron / a hosting scheduler:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/daily
 * Disabled unless CRON_SECRET is set.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = !!secret && secret.length >= 16 && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return new Response("Unauthorized", { status: 401 });
  const companies = await db.company.findMany({ select: { id: true } });
  const results: Record<string, unknown> = {};
  for (const c of companies) results[c.id] = await runDailyAutomations(c.id);
  return Response.json({ ok: true, results });
}
