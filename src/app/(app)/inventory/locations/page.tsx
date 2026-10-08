import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatINR, num } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormDialog } from "@/components/forms/form-dialog";
import { createWarehouse } from "../actions";

export const metadata = { title: "Stock Locations" };

export default async function LocationsPage() {
  const c = await requirePerm("inventory:view");
  const [locs, balances, projects] = await Promise.all([
    db.warehouse.findMany({ where: { companyId: c.companyId }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
    db.stockBalance.findMany({ where: { companyId: c.companyId, quantity: { gt: 0 } } }),
    db.project.findMany({ where: { companyId: c.companyId }, select: { id: true, code: true, name: true } }),
  ]);
  const pn = new Map(projects.map((p) => [p.id, `${p.code} · ${p.name}`]));
  const stat = (id: string) => {
    const b = balances.filter((x) => x.locationId === id);
    return { items: b.length, value: b.reduce((s, x) => s + num(x.quantity) * num(x.avgCost), 0) };
  };
  const section = (title: string, list: typeof locs) => (
    <Card>
      <CardHeader><CardTitle>{title} ({list.length})</CardTitle></CardHeader>
      {list.length === 0 ? <EmptyState title="None yet" /> : (
        <ul className="divide-y divide-slate-100">
          {list.map((l) => {
            const s = stat(l.id);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{l.name}</p><p className="text-xs text-slate-500">{l.projectId ? pn.get(l.projectId) : l.address ?? "—"}</p></div>
                <span className="text-sm text-slate-600">{s.items} materials</span>
                <span className="tabular text-sm font-medium">{formatINR(s.value)}</span>
                <Link className="text-sm font-medium text-brand-700 hover:underline" href={`/inventory/stock?${l.type === "SITE" ? "view=site&" : ""}location=${l.id}`}>View stock</Link>
                {!l.isActive && <Badge tone="slate">Inactive</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
  return (
    <>
      <PageHeader title="Stock locations" subtitle="Warehouses, and a site store for every project (created automatically on first issue)." actions={c.can("inventory:create") && <FormDialog title="New warehouse" trigger={<Button>Add warehouse</Button>} fields={[{ name: "name", label: "Name", required: true, full: true }, { name: "address", label: "Address", type: "textarea" }]} action={createWarehouse} />} />
      <div className="space-y-5">{section("Warehouses", locs.filter((l) => l.type === "WAREHOUSE"))}{section("Project sites", locs.filter((l) => l.type === "SITE"))}</div>
    </>
  );
}
