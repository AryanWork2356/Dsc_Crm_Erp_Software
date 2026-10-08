import { redirect } from "next/navigation";
import { FileDown } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatINR, humanize, num, startOfDay } from "@/lib/utils";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, StatCard } from "@/components/ui/page";
import { Badge, StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "My Invoices" };

export default async function ClientInvoices() {
  const c = await requireCtx();
  if (c.role !== "CLIENT" || !c.clientId) redirect("/");
  const [invs, pays] = await Promise.all([
    db.invoice.findMany({ where: { companyId: c.companyId, clientId: c.clientId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE", "PAID"] } }, include: { project: { select: { name: true } } }, orderBy: { issueDate: "desc" } }),
    db.payment.findMany({ where: { companyId: c.companyId, invoice: { clientId: c.clientId } }, include: { invoice: { select: { number: true } } }, orderBy: { date: "desc" }, take: 20 }),
  ]);
  const today = startOfDay();
  const billed = invs.reduce((s, i) => s + num(i.total), 0);
  const paid = invs.reduce((s, i) => s + num(i.paid), 0);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Invoices & payments</h1>
      <div className="grid grid-cols-3 gap-3"><StatCard label="Billed" value={formatINR(billed)} /><StatCard label="Paid" value={formatINR(paid)} tone="good" /><StatCard label="Outstanding" value={formatINR(billed - paid)} tone={billed - paid > 0 ? "warn" : "good"} /></div>
      <Card>
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        {invs.length === 0 ? <EmptyState title="No invoices yet" /> : (
          <ul className="divide-y divide-slate-100">{invs.map((i) => { const bal = num(i.total) - num(i.paid); const late = i.dueDate && i.dueDate < today && bal > 0.005; return (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{i.number}</p><p className="text-xs text-slate-500">{i.project?.name ?? ""} · issued {formatDate(i.issueDate)} · due {formatDate(i.dueDate)}</p></div>
              {late && <Badge tone="red">Overdue</Badge>}<StatusBadge status={i.status} />
              <div className="w-28 text-right"><p className="tabular text-sm font-semibold">{formatINR(i.total)}</p>{bal > 0.005 && <p className="tabular text-xs text-amber-700">due {formatINR(bal)}</p>}</div>
              <a href={`/finance/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer" className="rounded p-2 text-brand-700 hover:bg-brand-50" aria-label={`Download ${i.number}`}><FileDown className="h-4 w-4" /></a>
            </li>); })}</ul>
        )}
      </Card>
      <Card>
        <CardHeader><CardTitle>Payment history</CardTitle></CardHeader>
        {pays.length === 0 ? <EmptyState title="No payments recorded yet" /> : <ul className="divide-y divide-slate-100">{pays.map((p) => <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span>{formatDate(p.date)}</span><span className="text-slate-500">{p.invoice.number} · {humanize(p.method)}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular ml-auto font-semibold">{formatINR(p.amount)}</span></li>)}</ul>}
      </Card>
    </div>
  );
}
