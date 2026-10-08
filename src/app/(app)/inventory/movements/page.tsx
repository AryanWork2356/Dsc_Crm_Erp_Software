import Link from "next/link";
import type { InventoryTxnType, Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { projectOptions } from "@/lib/lookups";
import { formatDateTime, humanize, num, cn } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ListFilters } from "@/components/list/list-filters";

export const metadata = { title: "Stock Ledger" };
const TYPES: InventoryTxnType[] = ["INWARD", "OUTWARD", "TRANSFER", "RETURN", "ADJUSTMENT", "DAMAGED", "CONSUMED"];
const TONE: Record<string, "green" | "blue" | "amber" | "red" | "slate" | "teal"> = { INWARD: "green", OUTWARD: "blue", TRANSFER: "slate", RETURN: "teal", ADJUSTMENT: "amber", DAMAGED: "red", CONSUMED: "amber" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("inventory:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 30);
  const where: Prisma.InventoryTransactionWhereInput = {
    companyId: c.companyId,
    ...(sp.type ? { type: sp.type as InventoryTxnType } : {}),
    ...(sp.project ? { projectId: sp.project } : {}),
    ...(sp.material ? { materialId: sp.material } : {}),
    ...(lp.q ? { OR: [{ material: { name: { contains: lp.q, mode: "insensitive" } } }, { note: { contains: lp.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, projects, locs] = await Promise.all([
    db.inventoryTransaction.findMany({ where, include: { material: { select: { name: true, unit: true } } }, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
    db.inventoryTransaction.count({ where }),
    projectOptions(c.companyId),
    db.warehouse.findMany({ where: { companyId: c.companyId }, select: { id: true, name: true } }),
  ]);
  const ln = new Map(locs.map((l) => [l.id, l.name]));
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const un = new Map(users.map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader title="Stock ledger" subtitle="Every movement of material – nothing is ever overwritten." />
      <Card>
        <ListFilters placeholder="Search material or note…" filters={[{ key: "type", label: "Type", options: TYPES.map((t) => ({ value: t, label: humanize(t) })) }, { key: "project", label: "Project", options: projects }]} />
        {rows.length === 0 ? <EmptyState title="No movements yet" /> : (
          <>
            <Table>
              <THead><tr><Th>When</Th><Th>Type</Th><Th>Material</Th><Th right>Qty</Th><Th>From → To</Th><Th>Note</Th><Th>By</Th></tr></THead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                    <Td><Badge tone={TONE[r.type]}>{humanize(r.type)}</Badge></Td>
                    <Td><Link className="font-medium text-slate-900 hover:text-brand-700" href={`/inventory/materials/${r.materialId}`}>{r.material.name}</Link></Td>
                    <Td right className={cn("font-medium", r.type === "INWARD" || r.type === "RETURN" ? "text-emerald-700" : "")}>{num(r.quantity)} {r.material.unit}</Td>
                    <Td className="text-xs text-slate-600">{r.fromLocationId ? ln.get(r.fromLocationId) : "—"} → {r.toLocationId ? ln.get(r.toLocationId) : "—"}</Td>
                    <Td className="max-w-[260px] truncate text-xs text-slate-600">{r.note ?? ""}</Td>
                    <Td className="text-xs">{r.createdById ? un.get(r.createdById) ?? "—" : "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/inventory/movements" />
          </>
        )}
      </Card>
    </>
  );
}
