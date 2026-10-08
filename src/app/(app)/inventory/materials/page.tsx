import type { BoqCategory, Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams, orderBy } from "@/lib/list";
import { BOQ_CATEGORY_OPTS, UNIT_OPTS } from "@/lib/enums";
import { vendorOptions } from "@/lib/lookups";
import { formatINR, humanize, num, cn } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog, type FieldDef } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { createMaterial, deleteMaterial, updateMaterial } from "../../procurement/actions";

export const metadata = { title: "Materials" };

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("materials:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "name", "asc", 25);
  const vendors = await vendorOptions(c.companyId);

  const where: Prisma.MaterialWhereInput = {
    companyId: c.companyId,
    deletedAt: null,
    ...(sp.category ? { category: sp.category as BoqCategory } : {}),
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { sku: { contains: lp.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.material.findMany({ where, orderBy: orderBy(lp.sort, lp.dir, ["name", "sku", "category", "purchaseCost"] as const, "name"), skip: lp.skip, take: lp.take, include: { stock: { select: { quantity: true } }, vendor: { select: { name: true } } } }),
    db.material.count({ where }),
  ]);
  const canEdit = c.can("materials:edit");

  const fields = (m?: (typeof rows)[number]): FieldDef[] => [
    { name: "name", label: "Material name", required: true, full: true, defaultValue: m?.name ?? null },
    { name: "sku", label: "SKU / code", hint: "Leave empty to auto-generate", defaultValue: m?.sku ?? null },
    { name: "category", label: "Category", type: "select", options: BOQ_CATEGORY_OPTS, defaultValue: m?.category ?? "OTHER" },
    { name: "unit", label: "Unit", type: "select", options: UNIT_OPTS, defaultValue: m?.unit ?? "nos" },
    { name: "purchaseCost", label: "Last purchase cost (₹/unit)", type: "number", defaultValue: m ? num(m.purchaseCost) : 0 },
    { name: "minStock", label: "Minimum stock", type: "number", defaultValue: m ? num(m.minStock) : 0 },
    { name: "reorderLevel", label: "Reorder level", type: "number", defaultValue: m ? num(m.reorderLevel) : 0, hint: "Alert procurement at or below this" },
    { name: "vendorId", label: "Usual vendor", type: "select", options: vendors, defaultValue: m?.vendorId ?? null },
  ];

  return (
    <>
      <PageHeader
        title="Materials"
        subtitle="The catalogue used in BOQs, purchase requests and orders."
        actions={c.can("materials:create") && <FormDialog title="New material" wide trigger={<Button>Add material</Button>} fields={fields()} action={createMaterial} successMessage="Material added" />}
      />
      <Card>
        <ListFilters placeholder="Search name or SKU…" filters={[{ key: "category", label: "Category", options: BOQ_CATEGORY_OPTS }]} />
        {rows.length === 0 ? (
          <EmptyState title="No materials yet" hint="Add the materials you buy regularly so they can be picked in BOQs and orders." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <SortTh label="Material" field="name" sp={sp} basePath="/inventory/materials" />
                  <SortTh label="Category" field="category" sp={sp} basePath="/inventory/materials" />
                  <Th>Unit</Th><SortTh label="Cost" field="purchaseCost" sp={sp} basePath="/inventory/materials" right /><Th right>In stock</Th><Th right>Reorder at</Th><Th>Vendor</Th>{canEdit && <Th right>Actions</Th>}
                </tr>
              </THead>
              <tbody>
                {rows.map((m) => {
                  const qty = m.stock.reduce((s, x) => s + num(x.quantity), 0);
                  const low = num(m.reorderLevel) > 0 && qty <= num(m.reorderLevel);
                  return (
                    <Tr key={m.id}>
                      <Td><p className="font-medium text-slate-900">{m.name}</p><p className="text-xs text-slate-500">{m.sku}</p></Td>
                      <Td>{humanize(m.category)}</Td><Td>{m.unit}</Td>
                      <Td right>{formatINR(m.purchaseCost, true)}</Td>
                      <Td right className={cn(low && "font-semibold text-red-600")}>{qty}{low && <Badge tone="red" className="ml-2">Low</Badge>}</Td>
                      <Td right>{num(m.reorderLevel) || "—"}</Td>
                      <Td>{m.vendor?.name ?? "—"}</Td>
                      {canEdit && (
                        <Td right>
                          <div className="flex justify-end gap-1">
                            <FormDialog title="Edit material" wide trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={fields(m)} action={updateMaterial.bind(null, m.id)} />
                            {c.can("materials:delete") && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteMaterial.bind(null, m.id)} confirm={{ title: `Delete ${m.name}?`, confirmLabel: "Delete" }}>Delete</ActionButton>}
                          </div>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/inventory/materials" />
          </>
        )}
      </Card>
    </>
  );
}
