import Link from "next/link";
import type { Prisma, PaymentMethod } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { PAYMENT_METHOD_OPTS } from "@/lib/enums";
import { formatDate, formatINR, humanize, num, toDateInput } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { recordPayment } from "../actions";

export const metadata = { title: "Payments Received" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("payments:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "date", "desc", 25);
  const where: Prisma.PaymentWhereInput = {
    companyId: c.companyId,
    ...(sp.method ? { method: sp.method as PaymentMethod } : {}),
    ...(lp.q ? { OR: [{ reference: { contains: lp.q, mode: "insensitive" } }, { invoice: { number: { contains: lp.q, mode: "insensitive" } } }, { invoice: { client: { name: { contains: lp.q, mode: "insensitive" } } } }] } : {}),
  };
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [rows, total, month, open] = await Promise.all([
    db.payment.findMany({ where, include: { invoice: { select: { id: true, number: true, client: { select: { name: true } } } } }, orderBy: { date: "desc" }, skip: lp.skip, take: lp.take }),
    db.payment.count({ where }),
    db.payment.aggregate({ where: { companyId: c.companyId, date: { gte: monthStart } }, _sum: { amount: true } }),
    db.invoice.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } }, include: { client: { select: { name: true } } }, orderBy: { dueDate: "asc" } }),
  ]);
  const invOpts = open.map((i) => ({ value: i.id, label: `${i.number} · ${i.client.name} · due ${formatINR(num(i.total) - num(i.paid))}` }));
  return (
    <>
      <PageHeader title="Payments received" subtitle="Every rupee collected from clients." actions={c.can("payments:create") && <FormDialog title="Record payment" wide trigger={<Button>Record payment</Button>} fields={[{ name: "invoiceId", label: "Invoice", type: "select", required: true, options: invOpts, full: true }, { name: "amount", label: "Amount received (₹)", type: "number", required: true }, { name: "date", label: "Date received", type: "date", required: true, defaultValue: toDateInput(new Date()) }, { name: "method", label: "Method", type: "select", options: PAYMENT_METHOD_OPTS, defaultValue: "BANK_TRANSFER" }, { name: "reference", label: "Reference / UTR / cheque no." }, { name: "notes", label: "Notes", type: "textarea" }]} action={recordPayment} submitLabel="Record" />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label="Received this month" value={formatINR(month._sum.amount)} tone="good" /><StatCard label="Open invoices" value={open.length} href="/finance/receivables" /></div>
      <Card>
        <ListFilters placeholder="Search reference, invoice or client…" filters={[{ key: "method", label: "Method", options: PAYMENT_METHOD_OPTS }]} />
        {rows.length === 0 ? <EmptyState title="No payments recorded" /> : (
          <>
            <Table>
              <THead><tr><Th>Date</Th><Th>Client</Th><Th>Invoice</Th><Th>Method</Th><Th>Reference</Th><Th right>Amount</Th></tr></THead>
              <tbody>{rows.map((p) => <Tr key={p.id}><Td>{formatDate(p.date)}</Td><Td>{p.invoice.client.name}</Td><Td><Link className="text-brand-700 hover:underline" href={`/finance/invoices/${p.invoice.id}`}>{p.invoice.number}</Link></Td><Td>{humanize(p.method)}</Td><Td>{p.reference ?? "—"}</Td><Td right className="font-semibold text-slate-900">{formatINR(p.amount, true)}</Td></Tr>)}</tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/finance/payments" />
          </>
        )}
      </Card>
    </>
  );
}
