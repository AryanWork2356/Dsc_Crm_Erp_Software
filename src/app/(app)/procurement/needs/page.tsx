import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { needBoard, NEED_LABEL, syncMaterialNeeds, type NeedRow } from "@/lib/material-needs";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NEED_TONE } from "@/app/(app)/projects/[id]/material-needs-card";

export const metadata = { title: "Material Needed" };

const short = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ""));

/** Every site's materials list in one place, for Procurement: what is in trouble first, then what is coming up. */
export default async function MaterialNeededPage() {
  const c = await requirePerm("purchase_requests:view");
  if (c.can("purchase_requests:create")) await syncMaterialNeeds(c.companyId); // keeps the actions in step with what is on screen
  const projects = await db.project.findMany({ where: { ...projectScope(c), deletedAt: null }, select: { id: true } });
  const rows = projects.length ? await needBoard(c.companyId, projects.map((p) => p.id)) : [];
  const trouble = rows.filter((r) => r.problem).sort((a, b) => (a.problem!.severity === b.problem!.severity ? a.neededBy.getTime() - b.neededBy.getTime() : a.problem!.severity === "HIGH" ? -1 : 1));
  const coming = rows.filter((r) => !r.problem && r.status !== "ARRIVED" && r.days >= 0 && r.days <= 30);
  const later = rows.filter((r) => !r.problem && r.status !== "ARRIVED" && r.days > 30).length;
  const arrived = rows.filter((r) => r.status === "ARRIVED").length;
  const canAsk = c.can("purchase_requests:create");

  const table = (list: NeedRow[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm rt">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Site</th><th className="px-3 py-2 text-left">Material</th><th className="px-3 py-2 text-right">Needed</th><th className="px-3 py-2 text-left">On site by</th><th className="px-3 py-2 text-left">Where it stands</th><th className="px-3 py-2" /></tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className={cn("border-t border-slate-100 align-top", r.problem?.severity === "HIGH" && "bg-red-50/50")}>
              <td className="px-4 py-2.5"><Link href={`/projects/${r.projectId}?tab=materials`} className="font-medium text-brand-700 hover:underline">{r.projectCode}</Link><p className="text-xs text-slate-500">{r.projectName}</p></td>
              <td className="px-3 py-2.5"><p className="font-medium text-slate-900">{r.description}</p>{r.forWork && <p className="text-xs text-slate-500">for {r.forWork}</p>}</td>
              <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">{qty(r.quantity)} {r.unit}</td>
              <td className="whitespace-nowrap px-3 py-2.5">{short(r.neededBy)}<p className="text-xs text-slate-500">{r.days < 0 ? `${-r.days} day${r.days === -1 ? "" : "s"} ago` : r.days === 0 ? "today" : `in ${r.days} day${r.days === 1 ? "" : "s"}`}</p></td>
              <td className="px-3 py-2.5">
                <Badge tone={NEED_TONE[r.status]}>{NEED_LABEL[r.status]}</Badge>
                {r.status !== "NOT_ASKED" && <span className="ml-2 text-xs text-slate-500">received {qty(r.arrived)} · on order {qty(r.ordered)} · requested {qty(r.asked)}</span>}
                {r.problem && <p className={cn("mt-1 text-xs font-medium", r.problem.severity === "HIGH" ? "text-red-700" : "text-amber-700")}>{r.problem.text}</p>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right">{canAsk && (r.status === "NOT_ASKED" || r.status === "PART_ASKED") && <Link href={`/procurement/requests/new?need=${r.id}`}><Button size="sm" variant="secondary">Ask for it</Button></Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader title="Material Needed" subtitle="What each site's schedule needs, and by when. Where it stands is worked out from requests, orders and receipts." />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Need attention" value={String(trouble.length)} tone={trouble.length ? "bad" : "good"} />
          <StatCard label="Next 30 days, on track" value={String(coming.length)} />
          <StatCard label="Later" value={String(later)} />
          <StatCard label="Received" value={String(arrived)} tone="good" />
        </div>
        {rows.length === 0 ? <Card><EmptyState title="No materials listed on any site yet" hint="Each project's schedule can carry a Materials sheet, or materials can be added in the project's Materials tab." /></Card> : (
          <>
            <Card>
              <CardHeader><CardTitle className={trouble.length ? "text-red-600" : undefined}>Need attention ({trouble.length})</CardTitle></CardHeader>
              {trouble.length ? table(trouble) : <p className="px-5 pb-4 text-sm text-slate-500">Nothing is late or about to be late.</p>}
            </Card>
            <Card>
              <CardHeader><CardTitle>Coming up in the next 30 days ({coming.length})</CardTitle></CardHeader>
              {coming.length ? table(coming) : <p className="px-5 pb-4 text-sm text-slate-500">Nothing else is due in the next 30 days.</p>}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
