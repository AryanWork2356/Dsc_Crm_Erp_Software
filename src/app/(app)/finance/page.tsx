import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { monthlyCashFlow, payables, receivables } from "@/lib/finance-stats";
import { projectFinancials } from "@/lib/project-finance";
import { formatINR, formatINRCompact, num, cn } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { MoneyBars } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/page";

export const metadata = { title: "Finance" };

export default async function FinancePage() {
  const c = await requirePerm("finance:view");
  const [flow, rec, pay, projects, expenseMonth] = await Promise.all([
    monthlyCashFlow(c.companyId, 6),
    receivables(c.companyId),
    payables(c.companyId),
    db.project.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { notIn: ["CANCELLED"] } }, select: { id: true, code: true, name: true, contractValue: true, status: true }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.expense.aggregate({ where: { companyId: c.companyId, approved: true, date: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }, _sum: { amount: true } }),
  ]);
  const fin = await projectFinancials(c.companyId, projects.map((p) => p.id));
  const thisMonth = flow.at(-1);
  const net = (thisMonth?.income ?? 0) - (thisMonth?.expenses ?? 0);
  const ranked = projects.map((p) => ({ p, f: fin.get(p.id)! })).filter((x) => x.f && x.f.actualCost > 0).sort((a, b) => a.f.marginPct - b.f.marginPct).slice(0, 8);

  return (
    <>
      <PageHeader title="Finance overview" subtitle="Money in, money out, and who owes whom." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Receivable" value={formatINR(rec.total)} sub={`${rec.open.length} open invoice(s)`} href="/finance/receivables" />
        <StatCard label="Overdue receivable" value={formatINR(rec.overdueTotal)} tone={rec.overdueTotal ? "bad" : "good"} sub={`${rec.overdueCount} invoice(s)`} href="/finance/invoices?overdue=1" />
        <StatCard label="Payable" value={formatINR(pay.total)} sub={`${pay.open.length} unpaid bill(s)`} href="/finance/payables" />
        <StatCard label="Overdue payable" value={formatINR(pay.overdueTotal)} tone={pay.overdueTotal ? "warn" : "good"} sub={`${pay.overdueCount} bill(s)`} href="/finance/payables" />
      </div>
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Cash in vs out – last 6 months</CardTitle></CardHeader>
          <CardBody><MoneyBars data={flow.map((m) => ({ name: m.name, Income: m.income, Expenses: m.expenses }))} series={[{ key: "Income", label: "Money received" }, { key: "Expenses", label: "Money spent", color: "#c8872e" }]} /></CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>This month</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Received</p><p className="tabular text-2xl font-semibold text-emerald-700">{formatINR(thisMonth?.income)}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Spent</p><p className="tabular text-2xl font-semibold text-slate-900">{formatINR(thisMonth?.expenses)}</p></div>
            <div className="border-t border-slate-100 pt-3"><p className="text-xs uppercase tracking-wide text-slate-500">Net cash flow</p><p className={cn("tabular text-2xl font-semibold", net < 0 ? "text-red-600" : "text-emerald-700")}>{formatINRCompact(net)}</p></div>
            <p className="text-xs text-slate-500">Approved expenses this month: {formatINR(expenseMonth._sum.amount)}</p>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Projects with the thinnest margins</CardTitle><Link href="/projects" className="text-sm font-medium text-brand-700 hover:underline">All projects</Link></CardHeader>
        {ranked.length === 0 ? <EmptyState title="No project costs recorded yet" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Project</th><th className="px-4 py-2 text-right">Contract</th><th className="px-4 py-2 text-right">Actual cost</th><th className="px-4 py-2 text-right">Profit</th><th className="px-4 py-2 text-right">Margin</th><th className="px-4 py-2 text-right">Outstanding</th></tr></thead>
            <tbody>{ranked.map(({ p, f }) => <tr key={p.id} className="border-t border-slate-100"><td className="px-4 py-2.5"><Link href={`/projects/${p.id}?tab=financials`} className="font-medium text-slate-900 hover:text-brand-700">{p.code} · {p.name}</Link></td><td className="tabular px-4 py-2.5 text-right">{formatINR(num(p.contractValue))}</td><td className="tabular px-4 py-2.5 text-right">{formatINR(f.actualCost)}</td><td className="tabular px-4 py-2.5 text-right">{formatINR(f.profit)}</td><td className={cn("tabular px-4 py-2.5 text-right font-medium", f.marginPct < 15 ? "text-red-600" : "text-emerald-700")}>{f.marginPct.toFixed(1)}%</td><td className="tabular px-4 py-2.5 text-right">{formatINR(f.outstanding)}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </>
  );
}
