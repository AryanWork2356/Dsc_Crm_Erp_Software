import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { CHARGE_KINDS, companyProfit, fyLabel, fyMonths, fyOf, pctOf, sumCells, type Cell } from "@/lib/company-profit";
import { cn, formatDate, formatINR, formatINRCompact } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { saveCompanyCharge } from "./actions";

export const metadata = { title: "Company profit" };

const zero = (): Cell => sumCells([]);
const pct = (n: number, d: number) => { const v = pctOf(n, d); return v == null ? "—" : `${v.toFixed(1)} %`; };

type Line = { label: string; get: (c: Cell) => number; strong?: boolean; sub?: boolean; money?: boolean };
const LINES: Line[] = [
  { label: "Projects completed", get: (c) => c.projects, money: false },
  { label: "Revenue (contract value)", get: (c) => c.revenue, strong: true },
  { label: "Material", get: (c) => c.material, sub: true },
  { label: "Labour", get: (c) => c.labour, sub: true },
  { label: "Vendors and sub-contract", get: (c) => c.vendor, sub: true },
  { label: "Other project costs", get: (c) => c.otherDirect, sub: true },
  { label: "Direct cost of projects", get: (c) => c.directCost },
  { label: "Gross profit", get: (c) => c.grossProfit, strong: true },
  { label: "Office, travel and other costs", get: (c) => c.officeCosts, sub: true },
  { label: "Staff salaries", get: (c) => c.salaries, sub: true },
  { label: "Overheads", get: (c) => c.overheads },
  { label: "EBITDA", get: (c) => c.ebitda, strong: true },
  { label: "Depreciation", get: (c) => c.depreciation, sub: true },
  { label: "Interest on loans", get: (c) => c.interest, sub: true },
  { label: "Income tax", get: (c) => c.tax, sub: true },
  { label: "Net profit", get: (c) => c.netProfit, strong: true },
];

export default async function CompanyProfitPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const c = await requirePerm("finance:view");
  await requirePerm("margins:view");
  const sp = await searchParams;
  const data = await companyProfit(c.companyId);
  const thisFy = fyOf(new Date());
  const asked = Number(sp.fy);
  const fy = Number.isInteger(asked) && asked > 2000 && asked < 2100 ? asked : (data.years.includes(thisFy) ? thisFy : (data.years[0] ?? thisFy));
  const months = fyMonths(fy);
  const cells = months.map((m) => data.months.get(m.key) ?? zero());
  const total = sumCells(cells);
  const yearRows = data.years.map((y) => ({ y, t: sumCells(fyMonths(y).map((m) => data.months.get(m.key) ?? zero())) }));
  const missingCharges = months.filter((m) => { const k = data.months.get(m.key); return k && k.projects + k.overheads > 0 && !data.chargeMonths.has(m.key); }).length;
  const myProjects = data.projects.filter((p) => p.fy === fy);
  const periodOptions = months.map((m) => ({ value: m.key, label: m.label }));
  const o = data.orders;

  return (
    <>
      <PageHeader
        title="Company profit"
        subtitle="From completed projects only. Revenue and project cost fall in the month a project is completed; salaries and office costs fall in the month they were paid."
        actions={<FormDialog title="Add depreciation, interest or tax" description="The app cannot work these out. Type the amount for one month. Saving the same month and kind again replaces it; enter 0 to remove it." trigger={<Button variant="secondary">Add depreciation, interest, tax</Button>} action={saveCompanyCharge} fields={[
          { name: "period", label: "Month", type: "select", required: true, options: periodOptions, defaultValue: months[0].key },
          { name: "kind", label: "What is it", type: "select", required: true, options: Object.entries(CHARGE_KINDS).map(([value, label]) => ({ value, label })) },
          { name: "amount", label: "Amount (₹)", type: "number", required: true },
          { name: "note", label: "Note", full: true },
        ]} />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Financial year (April to March):</span>
        {[...new Set([...data.years, fy, thisFy])].sort((a, b) => b - a).map((y) => (
          <Link key={y} href={`/finance/profit?fy=${y}`} className={cn("rounded-full border px-3 py-1", y === fy ? "border-brand-700 bg-brand-50 font-semibold text-brand-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>{fyLabel(y)}</Link>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue" value={formatINRCompact(total.revenue)} sub={`${total.projects} completed project${total.projects === 1 ? "" : "s"}`} />
        <StatCard label="Gross profit" value={formatINRCompact(total.grossProfit)} sub={`Margin ${pct(total.grossProfit, total.revenue)}`} tone={total.grossProfit < 0 ? "bad" : "good"} />
        <StatCard label="EBITDA" value={formatINRCompact(total.ebitda)} sub={`${pct(total.ebitda, total.revenue)} of revenue`} tone={total.ebitda < 0 ? "bad" : "good"} />
        <StatCard label="Net profit" value={formatINRCompact(total.netProfit)} sub={`${pct(total.netProfit, total.revenue)} of revenue`} tone={total.netProfit < 0 ? "bad" : "good"} />
      </div>

      {missingCharges > 0 && (
        <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Depreciation, interest and tax have not been entered for {missingCharges} month{missingCharges === 1 ? "" : "s"} of this year. Until they are, <b>Net profit is the same as EBITDA</b> for those months. Use “Add depreciation, interest, tax” above.
        </p>
      )}

      <Card className="mb-5">
        <CardHeader><CardTitle>Month by month, {fyLabel(fy)}</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">{/* a month grid: swiped sideways on a phone, not cards */}
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="sticky left-0 bg-slate-50 px-4 py-2 text-left">&nbsp;</th>{months.map((m) => <th key={m.key} className="px-3 py-2 text-right">{m.label}</th>)}<th className="px-4 py-2 text-right">Year</th></tr>
            </thead>
            <tbody>
              {LINES.map((l) => (
                <tr key={l.label} className={cn("border-t border-slate-100", l.strong && "bg-slate-50/60 font-semibold")}>
                  <td className={cn("sticky left-0 whitespace-nowrap bg-white px-4 py-2", l.sub && "pl-8 text-slate-600", l.strong && "bg-slate-50")}>{l.label}</td>
                  {cells.map((cell, i) => { const v = l.get(cell); return <td key={months[i].key} className={cn("tabular whitespace-nowrap px-3 py-2 text-right", v < 0 && "text-red-600", v === 0 && "text-slate-300")}>{v === 0 ? "–" : l.money === false ? v : formatINR(v)}</td>; })}
                  <td className={cn("tabular whitespace-nowrap px-4 py-2 text-right font-semibold", l.get(total) < 0 && "text-red-600")}>{l.money === false ? l.get(total) : formatINR(l.get(total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader><CardTitle>Year by year</CardTitle></CardHeader>
        {yearRows.length === 0 ? <EmptyState title="Nothing to show yet" hint="Figures appear once a project is marked completed." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm rt">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Year</th><th className="px-3 py-2 text-right">Projects</th><th className="px-3 py-2 text-right">Revenue</th><th className="px-3 py-2 text-right">Gross profit</th><th className="px-3 py-2 text-right">Gross %</th><th className="px-3 py-2 text-right">EBITDA</th><th className="px-3 py-2 text-right">EBITDA %</th><th className="px-4 py-2 text-right">Net profit</th></tr></thead>
              <tbody>{yearRows.map(({ y, t }) => (
                <tr key={y} className="border-t border-slate-100"><td className="px-4 py-2.5"><Link className="font-medium text-brand-700 hover:underline" href={`/finance/profit?fy=${y}`}>{fyLabel(y)}</Link></td><td className="tabular px-3 py-2.5 text-right">{t.projects}</td><td className="tabular px-3 py-2.5 text-right">{formatINR(t.revenue)}</td><td className={cn("tabular px-3 py-2.5 text-right", t.grossProfit < 0 && "text-red-600")}>{formatINR(t.grossProfit)}</td><td className="tabular px-3 py-2.5 text-right">{pct(t.grossProfit, t.revenue)}</td><td className={cn("tabular px-3 py-2.5 text-right", t.ebitda < 0 && "text-red-600")}>{formatINR(t.ebitda)}</td><td className="tabular px-3 py-2.5 text-right">{pct(t.ebitda, t.revenue)}</td><td className={cn("tabular px-4 py-2.5 text-right font-semibold", t.netProfit < 0 && "text-red-600")}>{formatINR(t.netProfit)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <CardHeader><CardTitle>Purchase orders received and what we earned on them</CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-3 px-5 pt-4 lg:grid-cols-4">
          <StatCard label="Ordered by clients" value={formatINRCompact(o.poValue)} sub={`${o.poCount} purchase order${o.poCount === 1 ? "" : "s"}, all years`} />
          <StatCard label="Worked and completed" value={formatINRCompact(o.revenue)} sub="completed projects" />
          <StatCard label="Cost of that work" value={formatINRCompact(o.cost)} />
          <StatCard label="Profit on it" value={formatINRCompact(o.profit)} sub={`Margin ${pct(o.profit, o.revenue)}`} tone={o.profit < 0 ? "bad" : "good"} />
        </div>
        {o.byClient.length === 0 ? <EmptyState title="No client orders or completed projects yet" /> : (
          <div className="overflow-x-auto">
            <table className="mt-3 w-full text-sm rt">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Client</th><th className="px-3 py-2 text-right">PO value</th><th className="px-3 py-2 text-right">Projects done</th><th className="px-3 py-2 text-right">Revenue</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Profit</th><th className="px-4 py-2 text-right">Margin</th></tr></thead>
              <tbody>{o.byClient.map((r) => (
                <tr key={r.clientId} className="border-t border-slate-100"><td className="px-4 py-2.5"><Link className="font-medium text-slate-900 hover:text-brand-700" href={`/crm/clients/${r.clientId}`}>{r.name}</Link><p className="text-xs text-slate-500">{r.poCount} purchase order{r.poCount === 1 ? "" : "s"}</p></td><td className="tabular px-3 py-2.5 text-right">{formatINR(r.poValue)}</td><td className="tabular px-3 py-2.5 text-right">{r.projects}</td><td className="tabular px-3 py-2.5 text-right">{formatINR(r.revenue)}</td><td className="tabular px-3 py-2.5 text-right">{formatINR(r.cost)}</td><td className={cn("tabular px-3 py-2.5 text-right font-semibold", r.profit < 0 && "text-red-600")}>{formatINR(r.profit)}</td><td className="tabular px-4 py-2.5 text-right">{pct(r.profit, r.revenue)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <CardBody className="text-xs text-slate-500">The client’s purchase orders are what they have ordered; revenue is the contract value of their completed projects. A project that is still running is not counted in revenue or cost until it is completed.</CardBody>
      </Card>

      <Card className="mb-5">
        <CardHeader><CardTitle>Completed projects in {fyLabel(fy)}</CardTitle></CardHeader>
        {myProjects.length === 0 ? <EmptyState title="No project was completed in this year" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm rt">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Project</th><th className="px-3 py-2 text-left">Completed</th><th className="px-3 py-2 text-right">Revenue</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Profit</th><th className="px-4 py-2 text-right">Margin</th></tr></thead>
              <tbody>{myProjects.map((p) => (
                <tr key={p.id} className="border-t border-slate-100"><td className="px-4 py-2.5"><Link className="font-medium text-slate-900 hover:text-brand-700" href={`/projects/${p.id}`}>{p.name}</Link><p className="text-xs text-slate-500">{p.code} · {p.clientName}</p></td><td className="px-3 py-2.5">{formatDate(p.completedOn)}</td><td className="tabular px-3 py-2.5 text-right">{formatINR(p.revenue)}</td><td className="tabular px-3 py-2.5 text-right">{formatINR(p.cost)}</td><td className={cn("tabular px-3 py-2.5 text-right font-semibold", p.profit < 0 && "text-red-600")}>{formatINR(p.profit)}</td><td className="tabular px-4 py-2.5 text-right">{pct(p.profit, p.revenue)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>How this is counted</CardTitle></CardHeader>
        <CardBody className="space-y-2 text-sm text-slate-600">
          <p><b>Revenue</b>: the contract value (before GST) of each completed project, in the month it was completed.</p>
          <p><b>Direct cost</b>: what the project cost, as on its own page: material issued or received at site, labour, vendor and sub-contract bills, and project expenses.</p>
          <p><b>Gross profit</b>: revenue minus direct cost.</p>
          <p><b>Overheads</b>: approved expenses that are not charged to any project (office, travel, petty cash, miscellaneous) plus staff salaries from the payslips (basic, HRA, allowances, overtime, incentives, bonus). Site workers’ wages are already in the project cost.</p>
          <p><b>EBITDA</b>: gross profit minus overheads, before depreciation, interest and tax.</p>
          <p><b>Net profit</b>: EBITDA minus depreciation, interest and income tax, which Accounts types in for each month.</p>
          <p className="text-xs text-slate-500">These are management figures from the app’s own records, not audited accounts. DSC’s accountant should confirm the definitions (for example whether PF and ESI employer cost should be added to salaries) before they are quoted outside the company.</p>
        </CardBody>
      </Card>
    </>
  );
}
