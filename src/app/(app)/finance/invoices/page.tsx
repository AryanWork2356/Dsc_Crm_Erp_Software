import Link from "next/link";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams, orderBy } from "@/lib/list";
import { clientOptions, projectOptions } from "@/lib/lookups";
import { formatDate, formatINR, humanize, num, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";

export const metadata = { title: "Invoices" };
const STATUSES: InvoiceStatus[] = ["DRAFT", "PENDING_APPROVAL", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"];
const LIVE: InvoiceStatus[] = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("invoices:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 20);
  const today = startOfDay();
  const base: Prisma.InvoiceWhereInput = { companyId: c.companyId, deletedAt: null };
  const where: Prisma.InvoiceWhereInput = {
    AND: [base, {
      ...(sp.status ? { status: sp.status as InvoiceStatus } : {}),
      ...(sp.client ? { clientId: sp.client } : {}),
      ...(sp.project ? { projectId: sp.project } : {}),
      ...(sp.overdue ? { status: { in: LIVE }, dueDate: { lt: today } } : {}),
      ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { client: { name: { contains: lp.q, mode: "insensitive" } } }] } : {}),
    }],
  };
  const [rows, total, clients, projects, outstanding, overdue, collected] = await Promise.all([
    db.invoice.findMany({ where, include: { client: { select: { name: true } }, project: { select: { code: true } } }, orderBy: orderBy(lp.sort, lp.dir, ["createdAt", "number", "total", "dueDate", "issueDate"] as const, "createdAt"), skip: lp.skip, take: lp.take }),
    db.invoice.count({ where }),
    clientOptions(c.companyId), projectOptions(c.companyId),
    db.invoice.findMany({ where: { ...base, status: { in: LIVE } }, select: { total: true, paid: true } }),
    db.invoice.findMany({ where: { ...base, status: { in: LIVE }, dueDate: { lt: today } }, select: { total: true, paid: true } }),
    db.payment.aggregate({ where: { companyId: c.companyId, date: { gte: new Date(today.getFullYear(), today.getMonth(), 1) } }, _sum: { amount: true } }),
  ]);
  const bal = (r: { total: unknown; paid: unknown }[]) => r.reduce((s, i) => s + num(i.total as number) - num(i.paid as number), 0);

  return (
    <>
      <PageHeader title="Invoices" subtitle="What we've billed clients and what's still to collect." actions={c.can("invoices:create") && <Link href="/finance/invoices/new"><Button>New invoice</Button></Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Outstanding" value={formatINR(bal(outstanding))} sub={`${outstanding.length} open invoice(s)`} tone={outstanding.length ? "warn" : "default"} />
        <StatCard label="Overdue" value={formatINR(bal(overdue))} tone={overdue.length ? "bad" : "good"} href="/finance/invoices?overdue=1" sub={`${overdue.length} invoice(s)`} />
        <StatCard label="Collected this month" value={formatINR(collected._sum.amount)} tone="good" />
      </div>
      <Card>
        <ListFilters placeholder="Search number or client…" filters={[{ key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) }, { key: "client", label: "Client", options: clients }, { key: "project", label: "Project", options: projects }]} />
        {rows.length === 0 ? <EmptyState title="No invoices found" hint="Raise an invoice from a project milestone, an accepted quotation, or from scratch." /> : (
          <>
            <Table>
              <THead><tr><SortTh label="Invoice" field="number" sp={sp} basePath="/finance/invoices" /><Th>Client</Th><Th>Project</Th><SortTh label="Due" field="dueDate" sp={sp} basePath="/finance/invoices" /><SortTh label="Total" field="total" sp={sp} basePath="/finance/invoices" right /><Th right>Balance</Th><Th>Status</Th></tr></THead>
              <tbody>
                {rows.map((i) => {
                  const balance = num(i.total) - num(i.paid);
                  const late = i.dueDate && i.dueDate < today && balance > 0.005 && LIVE.includes(i.status);
                  return (
                    <Tr key={i.id}>
                      <Td><Link href={`/finance/invoices/${i.id}`} className="font-medium text-slate-900 hover:text-brand-700">{i.number}</Link><p className="text-xs text-slate-500">{formatDate(i.issueDate)}</p></Td>
                      <Td>{i.client.name}</Td><Td>{i.project?.code ?? "—"}</Td>
                      <Td className={cn(late && "font-medium text-red-600")}>{formatDate(i.dueDate)}{late && <Badge tone="red" className="ml-1.5">Overdue</Badge>}</Td>
                      <Td right className="font-medium text-slate-900">{formatINR(i.total)}</Td>
                      <Td right className={balance > 0.005 && LIVE.includes(i.status) ? "text-amber-700" : "text-slate-400"}>{LIVE.includes(i.status) ? formatINR(balance) : "—"}</Td>
                      <Td><StatusBadge status={i.status} /></Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/finance/invoices" />
          </>
        )}
      </Card>
    </>
  );
}
