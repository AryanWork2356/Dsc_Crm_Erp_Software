import Link from "next/link";
import type { BoqStatus, Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { projectOptions } from "@/lib/lookups";
import { formatDate, formatINR, humanize, num } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { createBoq } from "./actions";
import { projectScope } from "@/lib/scope";

export const metadata = { title: "Bill of Quantities" };
const STATUSES: BoqStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REVISED"];

export default async function BoqListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("boq:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "updatedAt", "desc", 20);
  const canCosts = c.can("margins:view");

  // PMs/designers only see BOQs of projects they work on (plus unattached drafts they can edit)
  const visibleProjects = c.role === "OWNER" || c.role === "MANAGEMENT" || c.role === "ADMIN" || c.role === "ACCOUNTS" || c.role === "SALES" || c.role === "PROCUREMENT"
    ? null
    : (await db.project.findMany({ where: projectScope(c), select: { id: true } })).map((p) => p.id);

  const where: Prisma.BoqWhereInput = {
    companyId: c.companyId,
    deletedAt: null,
    ...(visibleProjects ? { projectId: { in: visibleProjects } } : {}),
    ...(sp.status ? { status: sp.status as BoqStatus } : sp.all ? {} : { status: { not: "REVISED" } }),
    ...(sp.project ? { projectId: sp.project } : {}),
    ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { title: { contains: lp.q, mode: "insensitive" } }] } : {}),
  };
  const [rows, total, projects] = await Promise.all([
    db.boq.findMany({ where, include: { project: { select: { code: true, name: true } }, items: { select: { estimatedCost: true, total: true } } }, orderBy: { updatedAt: lp.dir }, skip: lp.skip, take: lp.take }),
    db.boq.count({ where }),
    projectOptions(c.companyId),
  ]);

  return (
    <>
      <PageHeader
        title="Bill of Quantities"
        subtitle="Itemised scope, costs and selling rates. The base for quotations, purchasing and project profit."
        actions={c.can("boq:create") && (
          <FormDialog title="New BOQ" trigger={<Button>New BOQ</Button>} fields={[
            { name: "title", label: "Title", required: true, full: true, placeholder: "e.g. Kapoor residence – interior BOQ" },
            { name: "projectId", label: "Project (optional)", type: "select", options: projects, full: true },
            { name: "notes", label: "Notes", type: "textarea" },
          ]} action={createBoq} successMessage="BOQ created" />
        )}
      />
      <Card>
        <ListFilters placeholder="Search number or title…" filters={[
          { key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { key: "project", label: "Project", options: projects },
        ]} />
        {rows.length === 0 ? (
          <EmptyState title="No BOQs found" hint="Create one here, or convert an accepted quotation into a project." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>BOQ</Th><Th>Project</Th><Th right>Items</Th>
                  {canCosts && <Th right>Est. cost</Th>}
                  <Th right>Selling</Th>
                  {canCosts && <Th right>Margin</Th>}
                  <Th>Status</Th><Th>Updated</Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((b) => {
                  const cost = b.items.reduce((s, i) => s + num(i.estimatedCost), 0);
                  const rev = b.items.reduce((s, i) => s + num(i.total), 0);
                  const m = rev > 0 ? ((rev - cost) / rev) * 100 : 0;
                  return (
                    <Tr key={b.id}>
                      <Td>
                        <Link href={`/sales/boq/${b.id}`} className="font-medium text-slate-900 hover:text-brand-700">{b.number}</Link>
                        <p className="max-w-[260px] truncate text-xs text-slate-500">{b.title}</p>
                      </Td>
                      <Td>{b.project ? `${b.project.code} · ${b.project.name}` : "—"}</Td>
                      <Td right>{b.items.length}</Td>
                      {canCosts && <Td right>{formatINR(cost)}</Td>}
                      <Td right className="font-medium text-slate-900">{formatINR(rev)}</Td>
                      {canCosts && <Td right className={m < 15 && rev > 0 ? "font-medium text-red-600" : "text-emerald-700"}>{rev > 0 ? `${m.toFixed(1)}%` : "—"}</Td>}
                      <Td><StatusBadge status={b.status} /></Td>
                      <Td>{formatDate(b.updatedAt)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/sales/boq" />
          </>
        )}
      </Card>
    </>
  );
}
