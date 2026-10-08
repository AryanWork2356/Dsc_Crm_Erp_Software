import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, num, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState, Progress } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Deliveries" };

export default async function DeliveriesPage() {
  const c = await requirePerm("purchase_orders:view");
  const today = startOfDay();
  const [open, receipts] = await Promise.all([
    db.purchaseOrder.findMany({ where: { companyId: c.companyId, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] } }, include: { vendor: { select: { name: true } }, project: { select: { code: true } }, items: true }, orderBy: [{ deliveryDate: { sort: "asc", nulls: "last" } }] }),
    db.materialReceipt.findMany({ where: { companyId: c.companyId }, include: { po: { select: { number: true, vendor: { select: { name: true } } } } }, orderBy: { deliveryDate: "desc" }, take: 15 }),
  ]);
  const late = open.filter((p) => p.deliveryDate && p.deliveryDate < today);
  const soon = open.filter((p) => !p.deliveryDate || p.deliveryDate >= today);

  const row = (p: (typeof open)[number]) => {
    const ord = p.items.reduce((s, i) => s + num(i.quantity), 0);
    const got = p.items.reduce((s, i) => s + num(i.receivedQty), 0);
    const isLate = p.deliveryDate && p.deliveryDate < today;
    return (
      <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <Link href={`/procurement/orders/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.number}</Link>
          <p className="text-xs text-slate-500">{p.vendor.name} · {p.project?.code ?? "Stock"}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500"><Progress value={ord ? (got / ord) * 100 : 0} className="w-20" />{got}/{ord}</div>
        <span className={cn("text-sm", isLate && "font-medium text-red-600")}>{formatDate(p.deliveryDate)}</span>
        {isLate && <Badge tone="red">Overdue</Badge>}
        <StatusBadge status={p.status} />
        {c.can("inventory:create") && <Link href={`/inventory/receipts/new?poId=${p.id}`}><Button size="sm" variant="secondary">Receive</Button></Link>}
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Deliveries" subtitle="Material we are waiting for, and what has arrived." />
      <div className="space-y-5">
        {late.length > 0 && <Card><CardHeader><CardTitle className="text-red-600">Overdue ({late.length})</CardTitle></CardHeader><ul className="divide-y divide-slate-100">{late.map(row)}</ul></Card>}
        <Card>
          <CardHeader><CardTitle>Expected ({soon.length})</CardTitle></CardHeader>
          {soon.length === 0 ? <EmptyState title="No pending deliveries" /> : <ul className="divide-y divide-slate-100">{soon.map(row)}</ul>}
        </Card>
        <Card>
          <CardHeader><CardTitle>Recently received</CardTitle></CardHeader>
          {receipts.length === 0 ? <EmptyState title="Nothing received yet" /> : (
            <ul className="divide-y divide-slate-100">
              {receipts.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"><span className="font-medium">{r.number}</span><span className="text-slate-500">{r.po.number} · {r.po.vendor.name}</span><span className="ml-auto text-slate-500">{formatDate(r.deliveryDate)}{r.challanNo ? ` · ${r.challanNo}` : ""}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
