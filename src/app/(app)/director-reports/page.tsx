import Link from "next/link";
import { FileDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { flatten } from "@/lib/list";
import { monthlyReport, weeklyReport } from "@/lib/director-reports";
import { MoneyBars } from "@/components/ui/charts";
import { cn, formatDate, formatINR } from "@/lib/utils";
import { PageHeader, StatCard, TabLinks, EmptyState } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Director reports" };

function Rows({ rows, empty }: { rows: [string, string, boolean?][]; empty: string }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-slate-500">{empty}</p>;
  return <ul className="divide-y divide-slate-100">{rows.map(([a, b, bad], i) => <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"><span className="min-w-0 truncate text-slate-700">{a}</span><span className={cn("tabular shrink-0 font-medium", bad ? "text-red-600" : "text-slate-900")}>{b}</span></li>)}</ul>;
}

export default async function DirectorReports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("finance:view");
  const sp = flatten(await searchParams);
  const kind = sp.kind === "monthly" ? "monthly" : "weekly";
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const [yy, mm] = (sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`).split("-").map(Number);
  const monthKey = `${yy}-${String(mm).padStart(2, "0")}`;
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); return { key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }) }; });

  return (
    <div>
      <PageHeader
        title="Director reports"
        subtitle="Prepared automatically from live records – nobody has to compile them. The weekly report is announced every Monday morning."
        actions={<Button asChild variant="secondary" size="sm"><a href={`/director-reports/pdf?kind=${kind}&month=${monthKey}`} target="_blank" rel="noreferrer"><FileDown className="h-4 w-4" /> PDF</a></Button>}
      />
      <div className="mb-4"><TabLinks current={kind} tabs={[{ key: "weekly", label: "Weekly", href: "/director-reports" }, { key: "monthly", label: "Monthly", href: "/director-reports?kind=monthly" }]} /></div>
      {kind === "weekly" ? <Weekly companyId={c.companyId} /> : (
        <>
          <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">Month: {months.map((m) => <Link key={m.key} href={`/director-reports?kind=monthly&month=${m.key}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium", m.key === monthKey ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-300 hover:bg-slate-50")}>{m.label}</Link>)}</p>
          <Monthly companyId={c.companyId} year={yy} month={mm} />
        </>
      )}
    </div>
  );
}

async function Weekly({ companyId }: { companyId: string }) {
  const r = await weeklyReport(companyId);
  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">As on {formatDate(r.asOf)}</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="To collect" value={formatINR(r.receivables.total)} sub={`${formatINR(r.receivables.overdue)} overdue`} tone={r.receivables.overdue ? "warn" : "good"} />
        <StatCard label="To pay" value={formatINR(r.payables.total)} sub={`${formatINR(r.payables.overdue)} overdue`} tone={r.payables.overdue ? "warn" : "good"} />
        <StatCard label="Next 7 days (net)" value={formatINR(r.forecast.net)} sub={`in ${formatINR(r.forecast.in)} · out ${formatINR(r.forecast.out)}`} tone={r.forecast.net < 0 ? "bad" : "good"} />
        <StatCard label="Bills awaiting certification" value={r.payables.notCertified} sub={formatINR(r.payables.notCertifiedAmount)} tone={r.payables.notCertified ? "warn" : "good"} />
      </div>
      <p className="text-xs text-slate-500">{r.forecast.note}</p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Collections – client-wise</CardTitle></CardHeader><Rows empty="Nothing to collect." rows={r.receivables.byClient.map((x) => [x.name, `${formatINR(x.total)}${x.overdue ? ` · ${formatINR(x.overdue)} overdue` : ""}`, x.overdue > 0])} /></Card>
        <Card><CardHeader><CardTitle>Payables – vendor-wise</CardTitle></CardHeader><Rows empty="Nothing to pay." rows={r.payables.byVendor.map((x) => [x.name, `${formatINR(x.total)}${x.overdue ? ` · ${formatINR(x.overdue)} overdue` : ""}`, x.overdue > 0])} /></Card>
        <Card><CardHeader><CardTitle>High-risk outstanding (over 60 days late)</CardTitle></CardHeader><Rows empty="None – nothing is more than 60 days late." rows={r.highRisk.map((x) => [`${x.number} · ${x.client}`, `${formatINR(x.balance)} · ${x.daysLate} days late`, true])} /></Card>
        <Card><CardHeader><CardTitle>Critical vendor payments (overdue over 30 days)</CardTitle></CardHeader><Rows empty="No vendor is overdue by more than 30 days." rows={r.criticalVendors.map((x) => [x.name, formatINR(x.overdue31plus), true])} /></Card>
      </div>
      <Card><CardHeader><CardTitle>Cash flow – last 6 months</CardTitle></CardHeader><div className="p-4"><MoneyBars data={r.cashFlow} series={[{ key: "income", label: "Money in", color: "#0d9488" }, { key: "expenses", label: "Money out", color: "#e11d48" }]} /></div></Card>
      <Card>
        <CardHeader><CardTitle>Where things are running late</CardTitle><Button asChild variant="link" size="sm"><Link href="/time-limits?view=all">Open time limits</Link></Button></CardHeader>
        {r.overdueByDepartment.length === 0 ? <EmptyState title="Nothing is past its time limit" /> : <Rows empty="" rows={r.overdueByDepartment.map((x) => [x.title, String(x.count), true])} />}
      </Card>
    </div>
  );
}

async function Monthly({ companyId, year, month }: { companyId: string; year: number; month: number }) {
  const r = await monthlyReport(companyId, year, month);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Turnover – ${r.label}`} value={formatINR(r.billed)} sub={`${r.invoicesIssued} invoice(s), excl. GST`} />
        <StatCard label="Collected" value={formatINR(r.collected)} />
        <StatCard label="Overall margin (live projects)" value={`${r.profitability.overallMarginPct.toFixed(1)}%`} sub={`${formatINR(r.profitability.profit)} on ${formatINR(r.profitability.contract)}`} tone={r.profitability.overallMarginPct < 15 ? "warn" : "good"} />
        <StatCard label="Projects closed" value={r.projectsClosed.length} sub={r.projectsClosed.map((p) => p.code).join(", ") || undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Most profitable projects</CardTitle></CardHeader><Rows empty="No projects with a contract value." rows={r.profitability.best.map((x) => [`${x.code} · ${x.name}`, `${x.marginPct.toFixed(1)}% · ${formatINR(x.profit)}`])} /></Card>
        <Card><CardHeader><CardTitle>Least profitable projects</CardTitle></CardHeader><Rows empty="No projects with a contract value." rows={r.profitability.worst.map((x) => [`${x.code} · ${x.name}`, `${x.marginPct.toFixed(1)}% · ${formatINR(x.profit)}`, x.marginPct < 10])} /></Card>
        <Card><CardHeader><CardTitle>Vendor performance (orders this month)</CardTitle></CardHeader><Rows empty="No purchase orders this month." rows={r.vendors.map((x) => [x.name, `${x.orders} order(s) · ${formatINR(x.value)}${x.late ? ` · ${x.late} late` : ""}`, x.late > 0])} /></Card>
        <Card><CardHeader><CardTitle>New vendors developed</CardTitle></CardHeader><Rows empty="No new vendors added this month." rows={r.newVendors.map((n) => [n, "New"])} /></Card>
      </div>
      <Card><CardHeader><CardTitle>Department performance – items past their time limit now</CardTitle></CardHeader>{r.overdueByDepartment.length === 0 ? <p className="px-5 py-4 text-sm text-slate-500"><Badge tone="green">Clear</Badge> Nothing is past its time limit.</p> : <Rows empty="" rows={r.overdueByDepartment.map((x) => [x.title, String(x.count), true])} />}</Card>
      <p className="text-xs text-slate-500">GST and TDS reconciliation are done by Accounts with the CA – use the Excel exports under Reports.</p>
    </div>
  );
}
