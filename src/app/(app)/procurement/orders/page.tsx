import Link from "next/link";
import type { Prisma, PoStatus } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten, listParams, orderBy } from "@/lib/list";
import { projectOptions, vendorOptions } from "@/lib/lookups";
import { formatDate, formatINR, humanize, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";

export const metadata = { title: "Purchase Orders" };
const STATUSES: PoStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"];
const OPEN: PoStatus[] = ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("purchase_orders:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 20);
  const today = startOfDay();
  const seeAll = ["OWNER", "MANAGEMENT", "ADMIN", "PROCUREMENT", "ACCOUNTS", "STORE"].includes(c.role);
  const myProjects = seeAll ? null : (await db.project.findMany({ where: projectScope(c), select: { id: true } })).map((p) => p.id);
  const money = c.can("margins:view") || c.can("vendor_bills:view") || c.role === "PROCUREMENT";

  const base: Prisma.PurchaseOrderWhereInput = { companyId: c.companyId, ...(myProjects ? { projectId: { in: myProjects } } : {}) };
  const where: Prisma.PurchaseOrderWhereInput = {
    AND: [base, {
      ...(sp.status ? { status: sp.status as PoStatus } : {}),
      ...(sp.vendor ? { vendorId: sp.vendor } : {}),
      ...(sp.project ? { projectId: sp.project } : {}),
      ...(sp.late ? { status: { in: OPEN }, deliveryDate: { lt: today } } : {}),
      ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { vendor: { name: { contains: lp.q, mode: "insensitive" } } }, { items: { some: { description: { contains: lp.q, mode: "insensitive" } } } }] } : {}),
    }],
  };
  const [rows, total, vendors, projects, pendingApproval, openCount, lateCount] = await Promise.all([
    db.purchaseOrder.findMany({ where, include: { vendor: { select: { name: true } }, project: { select: { code: true } } }, orderBy: orderBy(lp.sort, lp.dir, ["createdAt", "number", "total", "deliveryDate"] as const, "createdAt"), skip: lp.skip, take: lp.take }),
    db.purchaseOrder.count({ where }),
    vendorOptions(c.companyId), projectOptions(c.companyId),
    db.purchaseOrder.count({ where: { AND: [base, { status: "PENDING_APPROVAL" }] } }),
    db.purchaseOrder.count({ where: { AND: [base, { status: { in: OPEN } }] } }),
    db.purchaseOrder.count({ where: { AND: [base, { status: { in: OPEN }, deliveryDate: { lt: today } }] } }),
  ]);

  return (
    <>
      <PageHeader title="Purchase Orders" subtitle="Orders placed with vendors, from approval to delivery." actions={c.can("purchase_orders:create") && <Link href="/procurement/orders/new"><Button>New purchase order</Button></Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Awaiting approval" value={pendingApproval} tone={pendingApproval ? "warn" : "default"} href="/procurement/orders?status=PENDING_APPROVAL" />
        <StatCard label="Open – waiting for delivery" value={openCount} href="/procurement/deliveries" />
        <StatCard label="Delivery overdue" value={lateCount} tone={lateCount ? "bad" : "default"} href="/procurement/orders?late=1" />
      </div>
      <Card>
        <ListFilters placeholder="Search PO, vendor or item…" filters={[{ key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) }, { key: "vendor", label: "Vendor", options: vendors }, { key: "project", label: "Project", options: projects }]} />
        {rows.length === 0 ? <EmptyState title="No purchase orders" hint="Approved purchase requests can be turned into orders." /> : (
          <>
            <Table>
              <THead><tr><SortTh label="PO" field="number" sp={sp} basePath="/procurement/orders" /><Th>Vendor</Th><Th>Project</Th><SortTh label="Delivery" field="deliveryDate" sp={sp} basePath="/procurement/orders" />{money && <SortTh label="Total" field="total" sp={sp} basePath="/procurement/orders" right />}<Th>Status</Th></tr></THead>
              <tbody>
                {rows.map((p) => {
                  const late = p.deliveryDate && p.deliveryDate < today && OPEN.includes(p.status);
                  return (
                    <Tr key={p.id}>
                      <Td><Link href={`/procurement/orders/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.number}</Link><p className="text-xs text-slate-500">{formatDate(p.orderDate)}</p></Td>
                      <Td>{p.vendor.name}</Td><Td>{p.project?.code ?? "Stock"}</Td>
                      <Td className={cn(late && "font-medium text-red-600")}>{formatDate(p.deliveryDate)}{late && <Badge tone="red" className="ml-1.5">Late</Badge>}</Td>
                      {money && <Td right className="font-medium text-slate-900">{formatINR(p.total)}</Td>}
                      <Td><StatusBadge status={p.status} /></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/procurement/orders" />
          </>
        )}
      </Card>
    </>
  );
}
