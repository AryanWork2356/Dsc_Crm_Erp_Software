import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { BOQ_CATEGORY_OPTS } from "@/lib/enums";
import { formatINR, humanize, num, cn } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard, TabLinks } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { recordMovement } from "../actions";

export const metadata = { title: "Stock" };

export default async function StockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("inventory:view");
  const sp = flatten(await searchParams);
  const view = sp.view === "site" ? "SITE" : "WAREHOUSE";
  const lp = listParams(sp, "name", "asc", 25);
  const showValue = c.can("margins:view") || c.role === "STORE" || c.role === "PROCUREMENT" || c.can("finance:view");

  const [materials, balances, locations] = await Promise.all([
    db.material.findMany({ where: { companyId: c.companyId, deletedAt: null, ...(sp.category ? { category: sp.category as never } : {}), ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { sku: { contains: lp.q, mode: "insensitive" } }] } : {}) }, orderBy: { name: "asc" } }),
    db.stockBalance.findMany({ where: { companyId: c.companyId, ...(sp.location ? { locationId: sp.location } : {}) }, include: { location: { select: { id: true, name: true, type: true } } } }),
    db.warehouse.findMany({ where: { companyId: c.companyId, isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);

  const rows = materials.map((m) => {
    const mine = balances.filter((b) => b.materialId === m.id);
    const wh = mine.filter((b) => b.location.type === "WAREHOUSE");
    const site = mine.filter((b) => b.location.type === "SITE");
    const whQty = wh.reduce((s, b) => s + num(b.quantity), 0);
    const siteQty = site.reduce((s, b) => s + num(b.quantity), 0);
    const reserved = mine.reduce((s, b) => s + num(b.reserved), 0);
    const value = mine.reduce((s, b) => s + num(b.quantity) * num(b.avgCost), 0);
    const low = num(m.reorderLevel) > 0 && whQty <= num(m.reorderLevel);
    return { m, whQty, siteQty, reserved, value, low, qty: view === "SITE" ? siteQty : whQty, locs: (view === "SITE" ? site : wh).filter((b) => num(b.quantity) > 0) };
  }).filter((r) => (sp.low ? r.low : view === "SITE" ? r.siteQty > 0 : true));

  const total = rows.length;
  const page = rows.slice(lp.skip, lp.skip + lp.take);
  const lowCount = materials.filter((m) => num(m.reorderLevel) > 0 && balances.filter((b) => b.materialId === m.id && b.location.type === "WAREHOUSE").reduce((s, b) => s + num(b.quantity), 0) <= num(m.reorderLevel)).length;
  const stockValue = balances.reduce((s, b) => s + num(b.quantity) * num(b.avgCost), 0);
  const matOpts = materials.map((m) => ({ value: m.id, label: `${m.name} (${m.unit})` }));
  const locOpts = locations.map((l) => ({ value: l.id, label: l.name }));

  return (
    <>
      <PageHeader
        title="Stock"
        subtitle="What we have, where it is. Every change is recorded in the ledger."
        actions={c.can("inventory:create") && (
          <FormDialog
            title="Record a stock movement"
            description="Transfers, corrections after a stock-take, damaged goods, or material used on site."
            wide
            trigger={<Button variant="secondary">Record movement</Button>}
            fields={[
              { name: "type", label: "What happened?", type: "select", required: true, options: [{ value: "TRANSFER", label: "Transfer between locations" }, { value: "CONSUMED", label: "Consumed on site" }, { value: "DAMAGED", label: "Damaged / written off" }, { value: "ADJUSTMENT_ADD", label: "Correction: add stock" }, { value: "ADJUSTMENT_REMOVE", label: "Correction: remove stock" }] },
              { name: "materialId", label: "Material", type: "select", required: true, options: matOpts },
              { name: "quantity", label: "Quantity", type: "number", required: true },
              { name: "fromLocationId", label: "From / at location", type: "select", options: locOpts, hint: "Where the stock is now (not needed for “add stock”)" },
              { name: "toLocationId", label: "To location", type: "select", options: locOpts, hint: "Transfers and “add stock” only" },
              { name: "note", label: "Note / reason", type: "textarea", hint: "Required for corrections and damage" },
            ]}
            action={recordMovement}
            submitLabel="Record"
          />
        )}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Materials tracked" value={materials.length} />
        <StatCard label="Low stock" value={lowCount} tone={lowCount ? "bad" : "good"} href="/inventory/stock?low=1" />
        {showValue && <StatCard label="Inventory value" value={formatINR(stockValue)} sub="At moving-average cost" />}
        <StatCard label="Locations" value={locations.length} href="/inventory/locations" />
      </div>
      <TabLinks current={view === "SITE" ? "site" : "wh"} tabs={[{ key: "wh", label: "Warehouse stock", href: "/inventory/stock" }, { key: "site", label: "Site stock", href: "/inventory/stock?view=site" }]} />
      <Card>
        <ListFilters placeholder="Search material or SKU…" filters={[{ key: "category", label: "Category", options: BOQ_CATEGORY_OPTS }, { key: "location", label: "Location", options: locOpts }, { key: "low", label: "Alerts", options: [{ value: "1", label: "Low stock only" }] }]} />
        {page.length === 0 ? (
          <EmptyState title={sp.low ? "Nothing is below its reorder level" : "No stock to show"} hint="Stock appears here when material is received against a purchase order." />
        ) : (
          <>
            <Table>
              <THead><tr><Th>Material</Th><Th right>{view === "SITE" ? "At sites" : "In warehouse"}</Th><Th right>Reserved</Th><Th>Where</Th><Th right>Reorder at</Th>{showValue && <Th right>Value</Th>}<Th /></tr></THead>
              <tbody>
                {page.map(({ m, qty, reserved, locs, low, value }) => (
                  <Tr key={m.id}>
                    <Td><Link href={`/inventory/materials/${m.id}`} className="font-medium text-slate-900 hover:text-brand-700">{m.name}</Link><p className="text-xs text-slate-500">{m.sku} · {humanize(m.category)}</p></Td>
                    <Td right className={cn("font-semibold", low ? "text-red-600" : "text-slate-900")}>{qty} <span className="font-normal text-slate-500">{m.unit}</span></Td>
                    <Td right>{reserved || "—"}</Td>
                    <Td className="max-w-[260px] text-xs text-slate-600">{locs.map((b) => `${b.location.name}: ${num(b.quantity)}`).join(" · ") || "—"}</Td>
                    <Td right>{num(m.reorderLevel) || "—"}</Td>
                    {showValue && <Td right>{formatINR(value)}</Td>}
                    <Td>{low && <Badge tone="red">Low</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/inventory/stock" />
          </>
        )}
      </Card>
    </>
  );
}
