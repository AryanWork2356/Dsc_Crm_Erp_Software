import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { entityByKey, templateCsv } from "@/lib/importer";

export async function GET(req: NextRequest) {
  const c = await getCtx();
  const e = entityByKey(req.nextUrl.searchParams.get("entity") ?? "");
  if (!c || !e || !c.can(e.perm)) return new Response("Forbidden", { status: 403 });
  return new Response(templateCsv(e), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${e.key}-template.csv"` } });
}
