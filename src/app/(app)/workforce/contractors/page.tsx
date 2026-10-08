import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { formatINR, num } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { createContractor } from "../actions";
import { contractorFields } from "./contractor-fields";

export const metadata = { title: "Contractors" };

export default async function ContractorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("contractors:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "name", "asc", 20);
  const money = c.can("payments:view");
  const where: Prisma.ContractorWhereInput = { companyId: c.companyId, deletedAt: null, ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { contactPerson: { contains: lp.q, mode: "insensitive" } }, { phone: { contains: lp.q } }] } : {}) };
  const [rows, total] = await Promise.all([
    db.contractor.findMany({ where, orderBy: { name: "asc" }, skip: lp.skip, take: lp.take, include: { _count: { select: { workers: true } }, workOrders: { where: { status: { not: "CANCELLED" } }, select: { amount: true, status: true } }, payments: { select: { amount: true } } } }),
    db.contractor.count({ where }),
  ]);
  return (
    <>
      <PageHeader title="Contractors" subtitle="Labour contractors and sub-contractors, their work orders and payments." actions={c.can("contractors:create") && <FormDialog title="Add contractor" wide trigger={<Button>Add contractor</Button>} fields={contractorFields()} action={createContractor} successMessage="Contractor added" />} />
      <Card>
        <ListFilters placeholder="Search name, contact or phone…" />
        {rows.length === 0 ? <EmptyState title="No contractors yet" /> : (
          <>
            <Table>
              <THead><tr><Th>Contractor</Th><Th>Contact</Th><Th right>Workers</Th><Th right>Open work orders</Th>{money && <><Th right>Work value</Th><Th right>Paid</Th><Th right>Balance</Th></>}<Th right>Rating</Th></tr></THead>
              <tbody>
                {rows.map((x) => {
                  const value = x.workOrders.reduce((s, w) => s + num(w.amount), 0);
                  const paid = x.payments.reduce((s, p) => s + num(p.amount), 0);
                  return (
                    <Tr key={x.id}>
                      <Td><Link href={`/workforce/contractors/${x.id}`} className="font-medium text-slate-900 hover:text-brand-700">{x.name}</Link></Td>
                      <Td>{x.contactPerson ?? "—"}<p className="text-xs text-slate-500">{x.phone}</p></Td>
                      <Td right>{x._count.workers}</Td><Td right>{x.workOrders.filter((w) => w.status === "OPEN").length}</Td>
                      {money && <><Td right>{formatINR(value)}</Td><Td right>{formatINR(paid)}</Td><Td right className={value - paid > 0 ? "font-medium text-amber-700" : ""}>{formatINR(Math.max(0, value - paid))}</Td></>}
                      <Td right>{x.rating ? "★".repeat(x.rating) : "—"}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/workforce/contractors" />
          </>
        )}
      </Card>
    </>
  );
}
