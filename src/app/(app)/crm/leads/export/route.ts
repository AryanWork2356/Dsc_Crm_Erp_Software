import { NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/scope";
import { csvResponse } from "@/lib/list";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const c = await getCtx();
  if (!c || !c.can("leads:export")) return new Response("Forbidden", { status: 403 });
  const q = req.nextUrl.searchParams;
  const rows = await db.lead.findMany({
    where: {
      ...leadScope(c),
      ...(q.get("stage") ? { stage: q.get("stage") as never } : {}),
      ...(q.get("segment") ? { segment: q.get("segment") as never } : {}),
      ...(q.get("q") ? { OR: [{ name: { contains: q.get("q")!, mode: "insensitive" } }, { phone: { contains: q.get("q")! } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20000,
  });
  await audit(c, { action: "EXPORT", entityType: "Lead", summary: `Exported ${rows.length} leads` });
  return csvResponse(
    "leads.csv",
    ["Code", "Name", "Company", "Phone", "Email", "Source", "Segment", "Location", "Est. value", "Stage", "Priority", "Next follow-up", "Created"],
    rows.map((l) => [l.code, l.name, l.companyName, l.phone, l.email, l.source, l.segment, l.location, l.estimatedValue?.toString(), l.stage, l.priority, l.nextFollowUp, l.createdAt]),
  );
}
