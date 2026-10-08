import Link from "next/link";
import type { Prisma, PurchaseRequestStatus } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten, listParams } from "@/lib/list";
import { projectOptions } from "@/lib/lookups";
import { formatDate, humanize } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";

export const metadata = { title: "Purchase Requests" };
const STATUSES: PurchaseRequestStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "ORDERED"];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("purchase_requests:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 20);
  const seeAll = ["OWNER", "MANAGEMENT", "ADMIN", "PROCUREMENT", "ACCOUNTS"].includes(c.role);
  const myProjects = seeAll ? null : (await db.project.findMany({ where: projectScope(c), select: { id: true } })).map((p) => p.id);

  const base: Prisma.PurchaseRequestWhereInput = {
    companyId: c.companyId,
    ...(myProjects ? { OR: [{ requestedById: c.userId }, { projectId: { in: myProjects } }] } : {}),
  };
  const where: Prisma.PurchaseRequestWhereInput = {
    AND: [base, {
      ...(sp.status ? { status: sp.status as PurchaseRequestStatus } : {}),
      ...(sp.project ? { projectId: sp.project } : {}),
      ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { reason: { contains: lp.q, mode: "insensitive" } }, { items: { some: { description: { contains: lp.q, mode: "insensitive" } } } }] } : {}),
    }],
  };
  const [rows, total, projects, pending, approved] = await Promise.all([
    db.purchaseRequest.findMany({ where, include: { project: { select: { code: true, name: true } }, items: { select: { id: true } } }, orderBy: { createdAt: lp.dir }, skip: lp.skip, take: lp.take }),
    db.purchaseRequest.count({ where }),
    projectOptions(c.companyId),
    db.purchaseRequest.count({ where: { AND: [base, { status: "PENDING_APPROVAL" }] } }),
    db.purchaseRequest.count({ where: { AND: [base, { status: "APPROVED" }] } }),
  ]);
  const people = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requestedById))] } }, select: { id: true, name: true } });
  const nm = new Map(people.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader
        title="Purchase Requests"
        subtitle="What the site needs. Approved requests become purchase orders."
        actions={c.can("purchase_requests:create") && <Link href="/procurement/requests/new"><Button>New request</Button></Link>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Awaiting approval" value={pending} tone={pending ? "warn" : "default"} href="/procurement/requests?status=PENDING_APPROVAL" />
        <StatCard label="Approved – not yet ordered" value={approved} tone={approved ? "warn" : "default"} href="/procurement/requests?status=APPROVED" sub="Procurement should raise POs" />
      </div>
      <Card>
        <ListFilters placeholder="Search number, item or reason…" filters={[{ key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) }, { key: "project", label: "Project", options: projects }]} />
        {rows.length === 0 ? (
          <EmptyState title="No purchase requests" hint="Site teams raise a request when material is needed." />
        ) : (
          <>
            <Table>
              <THead><tr><Th>Request</Th><Th>Project</Th><Th>Requested by</Th><Th right>Items</Th><Th>Needed by</Th><Th>Priority</Th><Th>Status</Th></tr></THead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td><Link href={`/procurement/requests/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.number}</Link><p className="text-xs text-slate-500">{formatDate(r.createdAt)}</p></Td>
                    <Td>{r.project ? `${r.project.code} · ${r.project.name}` : "General stock"}</Td>
                    <Td>{nm.get(r.requestedById) ?? "—"}</Td>
                    <Td right>{r.items.length}</Td>
                    <Td>{formatDate(r.requiredDate)}</Td>
                    <Td><StatusBadge status={r.priority} /></Td>
                    <Td><StatusBadge status={r.status} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/procurement/requests" />
          </>
        )}
      </Card>
    </>
  );
}
