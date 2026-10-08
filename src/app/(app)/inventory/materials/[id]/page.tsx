import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime, formatINR, humanize, num } from "@/lib/utils";
import { PageHeader, StatCard, EmptyState } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function MaterialDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("materials:view");
  const m = await db.material.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { vendor: true, stock: { include: { location: true } } } });
  if (!m) notFound();
  const [txns, sums, locs] = await Promise.all([
    db.inventoryTransaction.findMany({ where: { materialId: id }, orderBy: { createdAt: "desc" }, take: 40 }),
    db.inventoryTransaction.groupBy({ by: ["type"], where: { materialId: id }, _sum: { quantity: true } }),
    db.warehouse.findMany({ where: { companyId: c.companyId }, select: { id: true, name: true } }),
  ]);
  const ln = new Map(locs.map((l) => [l.id, l.name]));
  const total = m.stock.reduce((s, b) => s + num(b.quantity), 0);
  const reserved = m.stock.reduce((s, b) => s + num(b.reserved), 0);
  const value = m.stock.reduce((s, b) => s + num(b.quantity) * num(b.avgCost), 0);
  const sum = (t: string) => num(sums.find((s) => s.type === t)?._sum.quantity);
  const low = num(m.reorderLevel) > 0 && m.stock.filter((b) => b.location.type === "WAREHOUSE").reduce((s, b) => s + num(b.quantity), 0) <= num(m.reorderLevel);

  return (
    <>
      <PageHeader back={{ href: "/inventory/materials", label: "Materials" }} title={m.name} subtitle={`${m.sku} · ${humanize(m.category)} · ${m.unit}${m.vendor ? ` · ${m.vendor.name}` : ""}`} actions={low ? <Badge tone="red">Low stock</Badge> : undefined} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="In stock (all locations)" value={`${total} ${m.unit}`} tone={low ? "bad" : "default"} sub={reserved ? `${reserved} reserved · ${total - reserved} available` : `Reorder at ${num(m.reorderLevel) || "—"}`} />
        <StatCard label="Stock value" value={formatINR(value)} />
        <StatCard label="Total received" value={sum("INWARD")} sub={`Returned ${sum("RETURN")}`} />
        <StatCard label="Used / lost" value={sum("CONSUMED") + sum("DAMAGED")} sub={`Consumed ${sum("CONSUMED")} · Damaged ${sum("DAMAGED")}`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>By location</CardTitle></CardHeader>
          {m.stock.filter((b) => num(b.quantity) > 0).length === 0 ? <EmptyState title="No stock" /> : (
            <ul className="divide-y divide-slate-100">
              {m.stock.filter((b) => num(b.quantity) > 0).map((b) => <li key={b.id} className="flex items-center justify-between px-5 py-3 text-sm"><span>{b.location.name}</span><span className="tabular font-medium">{num(b.quantity)} <span className="text-xs font-normal text-slate-500">@ {formatINR(b.avgCost)}</span></span></li>)}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Recent movements</CardTitle><Link className="text-sm font-medium text-brand-700 hover:underline" href={`/inventory/movements?material=${id}`}>Full ledger</Link></CardHeader>
          {txns.length === 0 ? <EmptyState title="No movements yet" /> : (
            <ul className="divide-y divide-slate-100">
              {txns.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm"><Badge>{humanize(t.type)}</Badge><span className="tabular font-medium">{num(t.quantity)}</span><span className="text-xs text-slate-500">{t.fromLocationId ? ln.get(t.fromLocationId) : "—"} → {t.toLocationId ? ln.get(t.toLocationId) : "—"}</span><span className="ml-auto text-xs text-slate-500">{formatDateTime(t.createdAt)}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
