import Link from "next/link";
import type { Prisma, Priority, TicketStatus } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams } from "@/lib/list";
import { PRIORITY_OPTS, TICKET_STATUS_OPTS } from "@/lib/enums";
import { clientOptions, userOptions } from "@/lib/lookups";
import { formatDate } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { createTicket } from "./actions";

export const metadata = { title: "Customer Support" };
const OPEN: TicketStatus[] = ["OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING"];

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("support:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 20);
  const [staff, clients] = await Promise.all([userOptions(c.companyId), clientOptions(c.companyId)]);
  const projects = await db.project.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, code: true, name: true, clientId: true }, orderBy: { createdAt: "desc" } });

  // site engineers/PMs: tickets on their projects or assigned to them
  const wide = ["OWNER", "MANAGEMENT", "ADMIN", "SALES"].includes(c.role);
  const mine: Prisma.SupportTicketWhereInput = wide ? {} : { OR: [{ assignedToId: c.userId }, { project: { OR: [{ projectManagerId: c.userId }, { siteEngineerId: c.userId }, { supervisorId: c.userId }] } }] };
  const base: Prisma.SupportTicketWhereInput = { companyId: c.companyId, ...mine };
  const where: Prisma.SupportTicketWhereInput = {
    AND: [base, {
      ...(sp.status === "open" || !sp.status ? { status: { in: OPEN } } : sp.status === "all" ? {} : { status: sp.status as TicketStatus }),
      ...(sp.priority ? { priority: sp.priority as Priority } : {}),
      ...(sp.warranty ? { isWarranty: true } : {}),
      ...(sp.assignee ? { assignedToId: sp.assignee } : {}),
      ...(lp.q ? { OR: [{ number: { contains: lp.q, mode: "insensitive" } }, { subject: { contains: lp.q, mode: "insensitive" } }, { client: { name: { contains: lp.q, mode: "insensitive" } } }] } : {}),
    }],
  };
  const [rows, total, open, urgent, warranty] = await Promise.all([
    db.supportTicket.findMany({ where, include: { client: { select: { name: true } }, project: { select: { code: true } } }, orderBy: { createdAt: "desc" }, skip: lp.skip, take: lp.take }),
    db.supportTicket.count({ where }),
    db.supportTicket.count({ where: { AND: [base, { status: { in: OPEN } }] } }),
    db.supportTicket.count({ where: { AND: [base, { status: { in: OPEN }, priority: { in: ["HIGH", "URGENT"] } }] } }),
    db.supportTicket.count({ where: { AND: [base, { status: { in: OPEN }, isWarranty: true }] } }),
  ]);
  const nm = new Map(staff.map((s) => [s.value, s.label]));

  return (
    <>
      <PageHeader title="Customer support" subtitle="Complaints, snagging and warranty requests from clients after handover." actions={c.can("support:create") && (
        <FormDialog title="Open a ticket" wide trigger={<Button>New ticket</Button>} fields={[
          { name: "clientId", label: "Client", type: "select", required: true, options: clients },
          { name: "projectId", label: "Project", type: "select", options: projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })), hint: "Warranty cover is worked out from the handover date" },
          { name: "subject", label: "Issue", required: true, full: true },
          { name: "priority", label: "Priority", type: "select", options: PRIORITY_OPTS, defaultValue: "MEDIUM" },
          { name: "assignedToId", label: "Assign to", type: "select", options: staff, hint: "Defaults to the project manager" },
          { name: "description", label: "Details", type: "textarea" },
        ]} action={createTicket} successMessage="Ticket opened" />
      )} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label="Open tickets" value={open} /><StatCard label="High priority" value={urgent} tone={urgent ? "bad" : "good"} /><StatCard label="Under warranty" value={warranty} href="/support?warranty=1" /></div>
      <Card>
        <ListFilters placeholder="Search ticket, issue or client…" filters={[{ key: "status", label: "Status", options: [{ value: "open", label: "Open (not closed)" }, { value: "all", label: "Everything" }, ...TICKET_STATUS_OPTS] }, { key: "priority", label: "Priority", options: PRIORITY_OPTS }, { key: "warranty", label: "Cover", options: [{ value: "1", label: "Under warranty" }] }, { key: "assignee", label: "Assigned to", options: staff }]} />
        {rows.length === 0 ? <EmptyState title="No tickets" hint="Great – nothing is waiting." /> : (
          <>
            <Table>
              <THead><tr><Th>Ticket</Th><Th>Client</Th><Th>Project</Th><Th>Priority</Th><Th>Assigned</Th><Th>Opened</Th><Th>Status</Th></tr></THead>
              <tbody>
                {rows.map((t) => (
                  <Tr key={t.id}>
                    <Td><Link href={`/support/${t.id}`} className="font-medium text-slate-900 hover:text-brand-700">{t.subject}</Link><p className="text-xs text-slate-500">{t.number} {t.isWarranty && <Badge tone="teal">Warranty</Badge>}</p></Td>
                    <Td>{t.client.name}</Td><Td>{t.project?.code ?? "—"}</Td><Td><StatusBadge status={t.priority} /></Td>
                    <Td>{t.assignedToId ? nm.get(t.assignedToId) ?? "—" : <span className="text-amber-600">Unassigned</span>}</Td><Td>{formatDate(t.createdAt)}</Td><Td><StatusBadge status={t.status} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/support" />
          </>
        )}
      </Card>
    </>
  );
}
