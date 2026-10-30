import Link from "next/link";
import type { Prisma, QuotationStatus } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams, orderBy } from "@/lib/list";
import { expireQuotations } from "@/lib/automation";
import { clientOptions } from "@/lib/lookups";
import { formatDate, formatINR, humanize, toDateInput } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { recordOutsideQuotation } from "./actions";

export const metadata = { title: "Quotations" };

const STATUSES: QuotationStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "VIEWED", "NEGOTIATION", "ACCEPTED", "REJECTED", "EXPIRED"];

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("quotations:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 20);
  await expireQuotations(c.companyId);

  const base: Prisma.QuotationWhereInput = {
    companyId: c.companyId,
    deletedAt: null,
    // Sales see quotations they prepared or for their leads
    ...(c.role === "SALES" ? { OR: [{ preparedById: c.userId }, { lead: { assignedToId: c.userId } }] } : {}),
    ...(c.role === "CLIENT" ? { clientId: c.clientId ?? "none", status: { in: ["SENT", "VIEWED", "NEGOTIATION", "ACCEPTED"] as QuotationStatus[] } } : {}),
  };
  const where: Prisma.QuotationWhereInput = {
    AND: [
      base,
      {
        ...(sp.status ? { status: sp.status as QuotationStatus } : {}),
        ...(sp.client ? { clientId: sp.client } : {}),
        ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { title: { contains: lp.q, mode: "insensitive" } }, { client: { name: { contains: lp.q, mode: "insensitive" } } }] } : {}),
      },
    ],
  };

  const [rows, total, clients, pending, approvedAgg, openAgg] = await Promise.all([
    db.quotation.findMany({
      where, include: { client: { select: { id: true, name: true } } },
      orderBy: orderBy(lp.sort, lp.dir, ["createdAt", "number", "total", "date"] as const, "createdAt"), skip: lp.skip, take: lp.take,
    }),
    db.quotation.count({ where }),
    clientOptions(c.companyId),
    db.quotation.count({ where: { AND: [base, { status: "PENDING_APPROVAL" }] } }),
    db.quotation.aggregate({ where: { AND: [base, { status: { in: ["APPROVED", "SENT", "VIEWED", "NEGOTIATION", "ACCEPTED"] } }] }, _sum: { total: true } }),
    db.quotation.aggregate({ where: { AND: [base, { status: { in: ["SENT", "VIEWED", "NEGOTIATION"] } }] }, _sum: { total: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle="Price proposals sent to clients. Every one goes through approval before it leaves the building."
        actions={c.can("quotations:create") && (
          <>
            <FormDialog title="Quotation made outside the app" description="Already made the quotation in Excel, Word or by hand? Record it here with its amount and file, so you can carry on in the app: mark it accepted, convert it to a project and bill it." trigger={<Button variant="secondary">Made outside the app</Button>}
              fields={[
                { name: "clientId", label: "Client", type: "select", options: clients, required: true, full: true },
                { name: "title", label: "What is it for?", placeholder: "e.g. 3 BHK interiors, Thane", full: true },
                { name: "number", label: "Quotation number (optional)", placeholder: "Leave empty to get a new number" },
                { name: "date", label: "Date of the quotation", type: "date", required: true, defaultValue: toDateInput(new Date()) },
                { name: "amount", label: "Amount before GST (₹)", type: "number", required: true },
                { name: "taxPercent", label: "GST %", type: "number", defaultValue: 18 },
                { name: "file", label: "The quotation file (PDF, Excel, Word or photo)", type: "file", full: true, hint: "Kept with the quotation, and copied to the project when it is converted" },
                { name: "accepted", label: "The client has already accepted it", type: "checkbox", hint: "Tick to go straight to Convert to project" },
              ]}
              action={recordOutsideQuotation} submitLabel="Record quotation" />
            <Link href="/sales/quotations/new"><Button>New quotation</Button></Link>
          </>
        )}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Awaiting approval" value={pending} tone={pending ? "warn" : "default"} href="/sales/quotations?status=PENDING_APPROVAL" />
        <StatCard label="Out with clients" value={formatINR(openAgg._sum.total)} sub="Sent, viewed or in negotiation" />
        <StatCard label="Approved value (all)" value={formatINR(approvedAgg._sum.total)} tone="good" />
      </div>
      <Card>
        <ListFilters
          placeholder="Search number, title or client…"
          filters={[
            { key: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
            ...(c.role === "CLIENT" ? [] : [{ key: "client", label: "Client", options: clients }]),
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState title="No quotations found" hint="Create a quotation from scratch, or from a BOQ." action={c.can("quotations:create") ? <Link href="/sales/quotations/new"><Button>New quotation</Button></Link> : undefined} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <SortTh label="Number" field="number" sp={sp} basePath="/sales/quotations" />
                  <Th>Client</Th><Th>Title</Th>
                  <SortTh label="Date" field="date" sp={sp} basePath="/sales/quotations" />
                  <Th>Valid until</Th>
                  <SortTh label="Total" field="total" sp={sp} basePath="/sales/quotations" right />
                  <Th>Status</Th>
                </tr>
              </THead>
              <tbody>
                {rows.map((q) => (
                  <Tr key={q.id}>
                    <Td>
                      <Link href={`/sales/quotations/${q.id}`} className="font-medium text-slate-900 hover:text-brand-700">{q.number}</Link>
                      {q.revision > 1 && <span className="ml-1.5 text-xs text-slate-500">rev {q.revision}</span>}
                    </Td>
                    <Td>{q.client.name}</Td>
                    <Td className="max-w-[220px] truncate">{q.title ?? "—"}</Td>
                    <Td>{formatDate(q.date)}</Td>
                    <Td>{formatDate(q.validUntil)}</Td>
                    <Td right className="font-medium text-slate-900">{formatINR(q.total)}</Td>
                    <Td><StatusBadge status={q.status} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/sales/quotations" />
          </>
        )}
      </Card>
    </>
  );
}
