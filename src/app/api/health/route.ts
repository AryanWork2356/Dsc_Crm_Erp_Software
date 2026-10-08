import { db } from "@/lib/db";

/** Load-balancer / uptime check: 200 when the app can reach its database. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
