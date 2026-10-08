import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { payables } from "@/lib/finance-stats";
import { BUCKETS } from "@/lib/aging";
import { formatDate, formatINR, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Payables" };

export default async function PayablesPage() {
  const c = await requirePerm("vendor_bills:view");
  const r = await payables(c.companyId);
  const today = startOfDay();
  const totals = BUCKETS.map((b) => r.aging.reduce((s, a) => s + a.buckets[b], 0));
  return (
    <>
      <PageHeader title="Payables" subtitle="What we owe vendors, by how late it is." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">{BUCKETS.map((b, i) => <StatCard key={b} label={b} value={formatINR(totals[i])} tone={i === 0 ? "default" : i >= 3 ? "bad" : "warn"} />)}</div>
      <Card className="mb-5">
        <CardHeader><CardTitle>By vendor</CardTitle><span className="tabular text-sm font-semibold">{formatINR(r.total)}</span></CardHeader>
        {r.aging.length === 0 ? <EmptyState title="No unpaid bills" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Vendor</th>{BUCKETS.map((b) => <th key={b} className="px-3 py-2 text-right">{b}</th>)}<th className="px-4 py-2 text-right">Total</th></tr></thead>
            <tbody>{r.aging.map((a) => <tr key={a.id} className="border-t border-slate-100"><td className="px-4 py-2.5"><Link href={`/procurement/vendors/${a.id}`} className="font-medium text-slate-900 hover:text-brand-700">{a.name}</Link><p className="text-xs text-slate-500">{a.count} bill(s)</p></td>{BUCKETS.map((b) => <td key={b} className={cn("tabular px-3 py-2.5 text-right", a.buckets[b] > 0 && b !== BUCKETS[0] && "font-medium text-red-600")}>{a.buckets[b] ? formatINR(a.buckets[b]) : "—"}</td>)}<td className="tabular px-4 py-2.5 text-right font-semibold">{formatINR(a.total)}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Unpaid bills</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href="/finance/bills">Manage bills</Link></CardHeader>
        {r.open.length === 0 ? <EmptyState title="Nothing to pay" /> : (
          <ul className="divide-y divide-slate-100">
            {[...r.open].sort((a, b) => ((a.dueDate ?? a.billDate).getTime()) - ((b.dueDate ?? b.billDate).getTime())).map((b) => {
              const late = (b.dueDate ?? b.billDate) < today;
              return <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"><span className="font-medium text-slate-900">{b.number}</span><span className="text-slate-500">{b.vendor.name}</span><span className={cn("ml-auto", late && "font-medium text-red-600")}>due {formatDate(b.dueDate)}</span>{late && <Badge tone="red">Overdue</Badge>}<span className="tabular w-28 text-right font-semibold">{formatINR(b.balance)}</span></li>;
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
