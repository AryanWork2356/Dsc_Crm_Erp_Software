import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { formatDate, num } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ListFilters } from "@/components/list/list-filters";

export const metadata = { title: "Material Receipts" };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("inventory:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "deliveryDate", "desc", 20);
  const where = { companyId: c.companyId, ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" as const } }, { challanNo: { contains: lp.q, mode: "insensitive" as const } }, { po: { number: { contains: lp.q, mode: "insensitive" as const } } }, { po: { vendor: { name: { contains: lp.q, mode: "insensitive" as const } } } }] } : {}) };
  const [rows, total, locs] = await Promise.all([
    db.materialReceipt.findMany({ where, include: { items: true, po: { select: { id: true, number: true, vendor: { select: { name: true } } } } }, orderBy: { deliveryDate: "desc" }, skip: lp.skip, take: lp.take }),
    db.materialReceipt.count({ where }),
    db.warehouse.findMany({ where: { companyId: c.companyId }, select: { id: true, name: true } }),
  ]);
  const ln = new Map(locs.map((l) => [l.id, l.name]));
  return (
    <>
      <PageHeader title="Material receipts" subtitle="Deliveries checked in against purchase orders (goods received notes)." actions={c.can("inventory:create") && <Link href="/inventory/receipts/new"><Button>Receive material</Button></Link>} />
      <Card>
        <ListFilters placeholder="Search receipt, PO, vendor, challan…" />
        {rows.length === 0 ? <EmptyState title="No receipts yet" /> : (
          <>
            <Table>
              <THead><tr><Th>Receipt</Th><Th>Purchase order</Th><Th>Vendor</Th><Th>Delivered to</Th><Th>Challan</Th><Th right>Accepted</Th><Th right>Damaged / rejected</Th></tr></THead>
              <tbody>
                {rows.map((r) => {
                  const acc = r.items.reduce((s, i) => s + num(i.acceptedQty), 0);
                  const bad = r.items.reduce((s, i) => s + num(i.damagedQty) + num(i.rejectedQty), 0);
                  return (
                    <Tr key={r.id}>
                      <Td><p className="font-medium text-slate-900">{r.number}</p><p className="text-xs text-slate-500">{formatDate(r.deliveryDate)}</p></Td>
                      <Td><Link className="text-brand-700 hover:underline" href={`/procurement/orders/${r.po.id}`}>{r.po.number}</Link></Td>
                      <Td>{r.po.vendor.name}</Td><Td>{ln.get(r.locationId) ?? "—"}</Td><Td>{r.challanNo ?? "—"}</Td>
                      <Td right>{acc}</Td><Td right>{bad > 0 ? <Badge tone="red">{bad}</Badge> : "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/inventory/receipts" />
          </>
        )}
      </Card>
    </>
  );
}
