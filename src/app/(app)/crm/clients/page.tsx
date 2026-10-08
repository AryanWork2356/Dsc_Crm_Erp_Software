import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScope } from "@/lib/scope";
import { flatten, listParams, orderBy } from "@/lib/list";
import { PM_ROLES, userOptions } from "@/lib/lookups";
import { formatDate, formatINR, num } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { createClient } from "../actions";
import { clientFields } from "./client-fields";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("clients:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 20);
  const showMoney = c.can("finance:view");

  const where: Prisma.ClientWhereInput = {
    ...clientScope(c),
    ...(lp.q ? { OR: [
      { name: { contains: lp.q, mode: "insensitive" } }, { companyName: { contains: lp.q, mode: "insensitive" } },
      { phone: { contains: lp.q } }, { code: { contains: lp.q, mode: "insensitive" } }, { email: { contains: lp.q, mode: "insensitive" } }, { gstin: { contains: lp.q, mode: "insensitive" } },
    ] } : {}),
  };
  const [rows, total, pms] = await Promise.all([
    db.client.findMany({
      where, orderBy: orderBy(lp.sort, lp.dir, ["createdAt", "name", "code"] as const, "createdAt"), skip: lp.skip, take: lp.take,
      include: { _count: { select: { projects: true } }, invoices: { where: { deletedAt: null, status: { notIn: ["CANCELLED", "DRAFT"] } }, select: { total: true, paid: true } } },
    }),
    db.client.count({ where }),
    userOptions(c.companyId, PM_ROLES),
  ]);

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle="Everyone you have a relationship with. One client can have many projects."
        actions={c.can("clients:create") && <FormDialog title="New client" wide trigger={<Button>Add client</Button>} fields={clientFields(pms)} action={createClient} successMessage="Client created" />}
      />
      <Card>
        <ListFilters placeholder="Search name, phone, GSTIN…" />
        {rows.length === 0 ? (
          <EmptyState title="No clients found" hint="Convert a won lead or add a client directly." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <SortTh label="Client" field="name" sp={sp} basePath="/crm/clients" />
                  <Th>Phone</Th><Th>Projects</Th>
                  {showMoney && <Th right>Outstanding</Th>}
                  <SortTh label="Since" field="createdAt" sp={sp} basePath="/crm/clients" />
                </tr>
              </THead>
              <tbody>
                {rows.map((cl) => {
                  const out = cl.invoices.reduce((s, i) => s + num(i.total) - num(i.paid), 0);
                  return (
                    <Tr key={cl.id}>
                      <Td>
                        <Link href={`/crm/clients/${cl.id}`} className="font-medium text-slate-900 hover:text-brand-700">{cl.name}</Link>
                        <p className="text-xs text-slate-500">{cl.code}{cl.companyName ? ` · ${cl.companyName}` : ""}</p>
                      </Td>
                      <Td>{cl.phone ?? "—"}</Td>
                      <Td>{cl._count.projects}</Td>
                      {showMoney && <Td right className={out > 0 ? "font-medium text-amber-700" : ""}>{formatINR(out)}</Td>}
                      <Td>{formatDate(cl.createdAt)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/crm/clients" />
          </>
        )}
      </Card>
    </>
  );
}
