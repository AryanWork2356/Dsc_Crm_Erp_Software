import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatINR, num, cn } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Compare BOQ" };

type Row = { item: string; unit: string; qA: number; qB: number; rA: number; rB: number; tA: number; tB: number; cA: number; cB: number };

export default async function CompareBoq({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const c = await requirePerm("boq:view");
  const sp = await searchParams;
  if (!sp.a || !sp.b) notFound();
  const [a, b] = await Promise.all(
    [sp.a, sp.b].map((id) => db.boq.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, include: { items: true } })),
  );
  if (!a || !b) notFound();
  const costs = c.can("margins:view");

  const key = (i: { category: string; item: string }) => `${i.category}|${i.item.trim().toLowerCase()}`;
  const mapA = new Map(a.items.map((i) => [key(i), i]));
  const mapB = new Map(b.items.map((i) => [key(i), i]));
  const keys = [...new Set([...mapA.keys(), ...mapB.keys()])];
  const rows = keys.map((k) => {
    const x = mapA.get(k);
    const y = mapB.get(k);
    return { k, item: (y ?? x)!.item, unit: (y ?? x)!.unit, qA: num(x?.quantity), qB: num(y?.quantity), rA: num(x?.sellingRate), rB: num(y?.sellingRate), tA: num(x?.total), tB: num(y?.total), cA: num(x?.estimatedCost), cB: num(y?.estimatedCost), state: !x ? "added" : !y ? "removed" : x.quantity.toString() !== y.quantity.toString() || x.sellingRate.toString() !== y.sellingRate.toString() ? "changed" : "same" } as Row & { k: string; state: string };
  });
  const changed = rows.filter((r) => r.state !== "same");
  const totA = a.items.reduce((s, i) => s + num(i.total), 0);
  const totB = b.items.reduce((s, i) => s + num(i.total), 0);
  const costA = a.items.reduce((s, i) => s + num(i.estimatedCost), 0);
  const costB = b.items.reduce((s, i) => s + num(i.estimatedCost), 0);

  return (
    <>
      <PageHeader back={{ href: `/sales/boq/${b.id}`, label: b.number }} title="Compare BOQ versions" subtitle={<><b>{a.number}</b> → <b>{b.number}</b> · {changed.length} item(s) differ</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Delta label="Selling total" a={totA} b={totB} />
        {costs && <Delta label="Estimated cost" a={costA} b={costB} invert />}
        {costs && <Delta label="Gross margin" a={totA - costA} b={totB - costB} />}
        <Delta label="Items" a={a.items.length} b={b.items.length} plain />
      </div>
      <Card>
        {changed.length === 0 ? (
          <EmptyState title="No differences" hint="Both versions have identical items, quantities and rates." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-2 text-left">Item</th><th className="px-4 py-2 text-left">Change</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Rate</th><th className="px-4 py-2 text-right">Total</th></tr>
              </thead>
              <tbody>
                {changed.map((r) => (
                  <tr key={r.k} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-medium text-slate-900">{r.item}<span className="ml-1 text-xs text-slate-400">{r.unit}</span></td>
                    <td className="px-4 py-2.5"><Badge tone={r.state === "added" ? "green" : r.state === "removed" ? "red" : "amber"}>{r.state}</Badge></td>
                    <td className="tabular px-4 py-2.5 text-right">{r.qA} → {r.qB}</td>
                    <td className="tabular px-4 py-2.5 text-right">{formatINR(r.rA)} → {formatINR(r.rB)}</td>
                    <td className={cn("tabular px-4 py-2.5 text-right font-medium", r.tB - r.tA > 0 ? "text-emerald-700" : "text-red-600")}>{r.tB - r.tA > 0 ? "+" : ""}{formatINR(r.tB - r.tA)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-4 text-sm"><Link className="text-brand-700 hover:underline" href={`/sales/boq/${a.id}`}>Open {a.number}</Link> · <Link className="text-brand-700 hover:underline" href={`/sales/boq/${b.id}`}>Open {b.number}</Link></p>
    </>
  );
}

function Delta({ label, a, b, invert, plain }: { label: string; a: number; b: number; invert?: boolean; plain?: boolean }) {
  const d = b - a;
  const good = invert ? d < 0 : d > 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold text-slate-900">{plain ? b : formatINR(b)}</p>
      <p className={cn("tabular text-xs", d === 0 ? "text-slate-500" : good ? "text-emerald-700" : "text-red-600")}>{d === 0 ? "no change" : `${d > 0 ? "+" : ""}${plain ? d : formatINR(d)} vs previous (${plain ? a : formatINR(a)})`}</p>
    </div>
  );
}
