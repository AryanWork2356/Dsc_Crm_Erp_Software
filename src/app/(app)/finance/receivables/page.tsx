import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { receivables } from "@/lib/finance-stats";
import { BUCKETS } from "@/lib/aging";
import { formatDate, formatINR, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";

export const metadata = { title: "Receivables" };

export default async function ReceivablesPage() {
  const c = await requirePerm("invoices:view");
  const r = await receivables(c.companyId);
  const today = startOfDay();
  // the latest follow-up on each open invoice: what was promised, and what happens next
  const notes = await db.collectionNote.findMany({ where: { companyId: c.companyId, invoiceId: { in: r.open.map((i) => i.id) } }, orderBy: { createdAt: "desc" } });
  const latest = new Map<string, (typeof notes)[number]>();
  for (const n of notes) if (!latest.has(n.invoiceId)) latest.set(n.invoiceId, n);
  const bucketTotals = BUCKETS.map((b) => r.aging.reduce((s, a) => s + a.buckets[b], 0));
  return (
    <>
      <PageHeader title="Receivables" subtitle="Money clients owe us, by how late it is." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {BUCKETS.map((b, i) => <StatCard key={b} label={b} value={formatINR(bucketTotals[i])} tone={i === 0 ? "default" : i >= 3 ? "bad" : "warn"} />)}
      </div>
      <Card className="mb-5">
        <CardHeader><CardTitle>By client</CardTitle><span className="tabular text-sm font-semibold">{formatINR(r.total)}</span></CardHeader>
        {r.aging.length === 0 ? <EmptyState title="Nothing outstanding 🎉" /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Client</th>{BUCKETS.map((b) => <th key={b} className="px-3 py-2 text-right">{b}</th>)}<th className="px-4 py-2 text-right">Total</th></tr></thead>
            <tbody>{r.aging.map((a) => <tr key={a.id} className="border-t border-slate-100"><td className="px-4 py-2.5"><Link href={`/crm/clients/${a.id}`} className="font-medium text-slate-900 hover:text-brand-700">{a.name}</Link><p className="text-xs text-slate-500">{a.count} invoice(s)</p></td>{BUCKETS.map((b) => <td key={b} className={cn("tabular px-3 py-2.5 text-right", a.buckets[b] > 0 && b !== BUCKETS[0] && "font-medium text-red-600")}>{a.buckets[b] ? formatINR(a.buckets[b]) : "—"}</td>)}<td className="tabular px-4 py-2.5 text-right font-semibold">{formatINR(a.total)}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Open invoices</CardTitle></CardHeader>
        {r.open.length === 0 ? <EmptyState title="No open invoices" /> : (
          <ul className="divide-y divide-slate-100">
            {[...r.open].sort((a, b) => ((a.dueDate ?? a.issueDate).getTime()) - ((b.dueDate ?? b.issueDate).getTime())).map((i) => {
              const late = (i.dueDate ?? i.issueDate) < today;
              const n = latest.get(i.id);
              const missed = !!n?.promisedDate && n.promisedDate < today;
              return (
                <li key={i.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3"><Link href={`/finance/invoices/${i.id}`} className="font-medium text-slate-900 hover:text-brand-700">{i.number}</Link><span className="text-slate-500">{i.client.name}</span><span className={cn("ml-auto", late && "font-medium text-red-600")}>due {formatDate(i.dueDate)}</span>{late && <Badge tone="red">Overdue</Badge>}<span className="tabular w-28 text-right font-semibold">{formatINR(i.balance)}</span></div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {n ? <>Last follow-up {formatDate(n.createdAt)}{n.promisedDate && <> · <span className={missed ? "font-medium text-red-600" : "text-amber-700"}>promised {formatDate(n.promisedDate)}{missed ? " – not received" : ""}</span></>}{n.nextAction && <> · next: {n.nextAction}{n.nextActionDate ? ` on ${formatDate(n.nextActionDate)}` : ""}</>}</> : <span className="text-amber-700">No follow-up recorded yet</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
