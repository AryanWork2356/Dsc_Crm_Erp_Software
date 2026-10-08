import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { projectOptions } from "@/lib/lookups";
import { flatten } from "@/lib/list";
import { formatINR, humanize, num, toDateInput } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Labour Cost" };

export default async function LabourPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("attendance:view");
  if (!c.can("margins:view") && !c.can("salary:view")) return <EmptyState title="Labour cost is restricted" hint="Ask the Owner or Accounts for access." />;
  const sp = flatten(await searchParams);
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : toDateInput(now).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  const visible = (await db.project.findMany({ where: projectScope(c), select: { id: true } })).map((p) => p.id);
  const rows = await db.attendance.findMany({
    where: { companyId: c.companyId, workerId: { not: null }, date: { gte: from, lte: to }, projectId: sp.project ? sp.project : { in: visible } },
    include: { worker: { select: { name: true, trade: true, contractor: { select: { name: true } } } } },
  });
  const byWorker = new Map<string, { name: string; trade: string; contractor?: string; days: number; ot: number; cost: number }>();
  for (const r of rows) {
    const k = r.workerId!;
    const x = byWorker.get(k) ?? { name: r.worker!.name, trade: r.worker!.trade, contractor: r.worker!.contractor?.name, days: 0, ot: 0, cost: 0 };
    x.days += r.status === "HALF_DAY" ? 0.5 : ["PRESENT", "OVERTIME"].includes(r.status) ? 1 : 0;
    x.ot += num(r.overtimeHrs);
    x.cost += num(r.wageCost);
    byWorker.set(k, x);
  }
  const list = [...byWorker.values()].sort((a, b) => b.cost - a.cost);
  const total = list.reduce((s, x) => s + x.cost, 0);
  const projects = await projectOptions(c.companyId);

  return (
    <>
      <PageHeader title="Labour cost" subtitle={`Wages from attendance for ${month}. Charged to the project each worker was marked at.`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label="Total wages" value={formatINR(total)} /><StatCard label="Worker-days" value={list.reduce((s, x) => s + x.days, 0)} /><StatCard label="Overtime hours" value={list.reduce((s, x) => s + x.ot, 0)} /></div>
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <label className="space-y-1 text-xs font-medium text-slate-600">Month<input type="month" name="month" defaultValue={month} className="block h-10 rounded-lg border border-slate-300 px-3 text-sm" /></label>
          <label className="space-y-1 text-xs font-medium text-slate-600">Project<select name="project" defaultValue={sp.project ?? ""} className="block h-10 min-w-[220px] rounded-lg border border-slate-300 px-3 text-sm"><option value="">All projects</option>{projects.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
          <button className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium shadow-sm hover:bg-slate-50">Show</button>
        </form>
        {list.length === 0 ? <EmptyState title="No attendance in this period" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Worker</th><th className="px-4 py-2 text-left">Trade</th><th className="px-4 py-2 text-left">Contractor</th><th className="px-4 py-2 text-right">Days</th><th className="px-4 py-2 text-right">OT hrs</th><th className="px-4 py-2 text-right">Wages</th></tr></thead>
            <tbody>{list.map((x) => <tr key={x.name} className="border-t border-slate-100"><td className="px-4 py-2.5 font-medium text-slate-900">{x.name}</td><td className="px-4 py-2.5">{humanize(x.trade)}</td><td className="px-4 py-2.5">{x.contractor ?? "—"}</td><td className="tabular px-4 py-2.5 text-right">{x.days}</td><td className="tabular px-4 py-2.5 text-right">{x.ot || "—"}</td><td className="tabular px-4 py-2.5 text-right font-medium">{formatINR(x.cost)}</td></tr>)}</tbody>
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold"><td className="px-4 py-2.5" colSpan={5}>Total</td><td className="tabular px-4 py-2.5 text-right">{formatINR(total)}</td></tr></tfoot></table></div>
        )}
      </Card>
    </>
  );
}
