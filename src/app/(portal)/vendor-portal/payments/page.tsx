import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatINR, humanize, num } from "@/lib/utils";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, StatCard } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "Payments" };

export default async function VendorPayments() {
  const c = await requireCtx();
  if (c.role !== "VENDOR" || !c.vendorId) redirect("/");
  const [bills, payments] = await Promise.all([
    db.vendorBill.findMany({ where: { companyId: c.companyId, vendorId: c.vendorId, status: { not: "CANCELLED" } }, orderBy: { billDate: "desc" } }),
    db.vendorPayment.findMany({ where: { companyId: c.companyId, vendorId: c.vendorId }, orderBy: { date: "desc" }, take: 25 }),
  ]);
  const owed = bills.reduce((s, b) => s + num(b.amount) - num(b.paid), 0);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Payment status</h1>
      <div className="grid grid-cols-3 gap-3"><StatCard label="Billed" value={formatINR(bills.reduce((s, b) => s + num(b.amount), 0))} /><StatCard label="Received" value={formatINR(bills.reduce((s, b) => s + num(b.paid), 0))} tone="good" /><StatCard label="Still to be paid" value={formatINR(owed)} tone={owed ? "warn" : "good"} /></div>
      <Card><CardHeader><CardTitle>Your bills</CardTitle></CardHeader>
        {bills.length === 0 ? <EmptyState title="No bills recorded" /> : <ul className="divide-y divide-slate-100">{bills.map((b) => <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"><span className="font-medium text-slate-900">{b.number}</span><span className="text-slate-500">{formatDate(b.billDate)}{b.dueDate ? ` · due ${formatDate(b.dueDate)}` : ""}</span><span className="tabular ml-auto">{formatINR(b.amount)}</span><StatusBadge status={b.status} /></li>)}</ul>}
      </Card>
      <Card><CardHeader><CardTitle>Payments received</CardTitle></CardHeader>
        {payments.length === 0 ? <EmptyState title="No payments yet" /> : <ul className="divide-y divide-slate-100">{payments.map((p) => <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span>{formatDate(p.date)}</span><span className="text-slate-500">{humanize(p.method)}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular ml-auto font-semibold">{formatINR(p.amount)}</span></li>)}</ul>}
      </Card>
    </div>
  );
}
