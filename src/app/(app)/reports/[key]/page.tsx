import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { canRun, reportByKey, type Column } from "@/lib/reports";
import { parseFilters } from "@/lib/report-filters";
import { formatDate, formatINR, num } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Params = { key: string };

export default async function ReportPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  const c = await requireCtx();
  const report = reportByKey(key);
  if (!report) notFound();
  if (!canRun(c, report)) redirect("/forbidden");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const [res, projects, clients, vendors] = await Promise.all([
    report.run(c, f),
    report.filters.includes("project") ? db.project.findMany({ where: projectScope(c), select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }) : [],
    report.filters.includes("client") ? db.client.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    report.filters.includes("vendor") ? db.vendor.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const qs = new URLSearchParams();
  for (const k of ["from", "to", "project", "client", "vendor"]) if (sp[k]) qs.set(k, sp[k]!);
  const cell = (col: Column, v: unknown) => {
    if (v === null || v === undefined || v === "") return "—";
    switch (col.type) {
      case "money": return formatINR(v as number, true);
      case "date": return formatDate(v as Date);
      case "pct": return `${num(v as number).toFixed(1)}%`;
      case "number": return String(num(v as number));
      default: return String(v);
    }
  };
  const sel = "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm";

  return (
    <>
      <PageHeader back={{ href: "/reports", label: "All reports" }} title={report.title} subtitle={report.description}
        actions={c.can("reports:export") && <>
          {(["csv", "xlsx", "pdf"] as const).map((fmt) => <a key={fmt} href={`/reports/${key}/export?${new URLSearchParams({ ...Object.fromEntries(qs), format: fmt })}`} target={fmt === "pdf" ? "_blank" : undefined} rel="noreferrer"><Button variant="secondary" size="sm">{fmt === "xlsx" ? "Excel" : fmt.toUpperCase()}</Button></a>)}
        </>}
      />
      {report.filters.length > 0 && (
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          {report.filters.includes("period") && <><label className="space-y-1 text-xs font-medium text-slate-600">From<input type="date" name="from" defaultValue={f.fromStr} className={`${sel} block`} /></label><label className="space-y-1 text-xs font-medium text-slate-600">To<input type="date" name="to" defaultValue={f.toStr} className={`${sel} block`} /></label></>}
          {report.filters.includes("project") && <label className="space-y-1 text-xs font-medium text-slate-600">Project<select name="project" defaultValue={sp.project ?? ""} className={`${sel} block min-w-[200px]`}><option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>}
          {report.filters.includes("client") && <label className="space-y-1 text-xs font-medium text-slate-600">Client<select name="client" defaultValue={sp.client ?? ""} className={`${sel} block min-w-[180px]`}><option value="">All</option>{clients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
          {report.filters.includes("vendor") && <label className="space-y-1 text-xs font-medium text-slate-600">Vendor<select name="vendor" defaultValue={sp.vendor ?? ""} className={`${sel} block min-w-[180px]`}><option value="">All</option>{vendors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
          <Button type="submit">Run report</Button>
        </form>
      )}
      <Card>
        {res.rows.length === 0 ? <EmptyState title="No data for these filters" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{res.columns.map((col) => <th key={col.key} className={`whitespace-nowrap px-4 py-2.5 font-medium ${["money", "number", "pct"].includes(col.type ?? "") ? "text-right" : "text-left"}`}>{col.label}</th>)}</tr></thead>
              <tbody>{res.rows.slice(0, 500).map((r, i) => <tr key={i} className="border-t border-slate-100">{res.columns.map((col) => <td key={col.key} className={`px-4 py-2 ${["money", "number", "pct"].includes(col.type ?? "") ? "tabular text-right" : ""}`}>{cell(col, r[col.key])}</td>)}</tr>)}</tbody>
              {res.totals && <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">{res.columns.map((col) => <td key={col.key} className={`px-4 py-2.5 ${["money", "number", "pct"].includes(col.type ?? "") ? "tabular text-right" : ""}`}>{res.totals![col.key] !== undefined ? cell(col, res.totals![col.key]) : ""}</td>)}</tr></tfoot>}
            </table>
            {res.rows.length > 500 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing the first 500 of {res.rows.length} rows – export to get everything.</p>}
          </div>
        )}
      </Card>
    </>
  );
}
