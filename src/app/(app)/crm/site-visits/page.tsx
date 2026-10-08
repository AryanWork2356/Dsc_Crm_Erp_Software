import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/scope";
import { flatten, listParams } from "@/lib/list";
import { clientOptions, userOptions } from "@/lib/lookups";
import { formatDate, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { completeSiteVisit, createSiteVisit, deleteSiteVisit, updateSiteVisit } from "../actions";
import { siteVisitFields } from "./visit-fields";

export const metadata = { title: "Site Visits" };

export default async function SiteVisitsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("sitevisits:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "visitDate", "desc", 20);
  const today = startOfDay();

  // Sales only see visits on their own leads; PM/engineers see visits assigned to them. Management sees all.
  const mine: Prisma.SiteVisitWhereInput =
    ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role)
      ? {}
      : c.role === "SALES"
        ? { OR: [{ lead: leadScope(c) }, { assignedToId: c.userId }] }
        : { assignedToId: c.userId };

  const where: Prisma.SiteVisitWhereInput = {
    companyId: c.companyId,
    ...mine,
    ...(sp.status === "done" ? { completed: true } : sp.status === "upcoming" ? { completed: false } : {}),
    ...(lp.q ? { OR: [{ siteAddress: { contains: lp.q, mode: "insensitive" } }, { lead: { name: { contains: lp.q, mode: "insensitive" } } }, { client: { name: { contains: lp.q, mode: "insensitive" } } }] } : {}),
  };

  const [rows, total, users, leads, clients] = await Promise.all([
    db.siteVisit.findMany({ where, include: { lead: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } }, orderBy: { visitDate: lp.dir }, skip: lp.skip, take: lp.take }),
    db.siteVisit.count({ where }),
    userOptions(c.companyId),
    db.lead.findMany({ where: leadScope(c), select: { id: true, name: true, code: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    clientOptions(c.companyId),
  ]);
  const leadOpts = leads.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }));
  const nameOf = new Map(users.map((u) => [u.value, u.label]));
  const canEdit = c.can("sitevisits:edit");

  return (
    <>
      <PageHeader
        title="Site Visits"
        subtitle="Schedule visits, record measurements and conditions."
        actions={c.can("sitevisits:create") && (
          <FormDialog title="Schedule site visit" wide trigger={<Button>Schedule visit</Button>} fields={siteVisitFields({ users, leadOptions: leadOpts, clientOptions: clients })} action={createSiteVisit} successMessage="Site visit scheduled" />
        )}
      />
      <Card>
        <ListFilters placeholder="Search address, lead or client…" filters={[{ key: "status", label: "Status", options: [{ value: "upcoming", label: "Upcoming" }, { value: "done", label: "Completed" }] }]} />
        {rows.length === 0 ? (
          <EmptyState title="No site visits" hint="Schedule a visit from here or from a lead." />
        ) : (
          <>
            <Table>
              <THead>
                <tr><Th>Date</Th><Th>For</Th><Th>Site</Th><Th>Area</Th><Th>Assigned</Th><Th>Status</Th>{canEdit && <Th right>Actions</Th>}</tr>
              </THead>
              <tbody>
                {rows.map((v) => {
                  const late = !v.completed && v.visitDate < today;
                  return (
                    <Tr key={v.id}>
                      <Td className={cn("whitespace-nowrap", late && "font-medium text-red-600")}>{formatDate(v.visitDate)}{v.visitTime ? ` · ${v.visitTime}` : ""}</Td>
                      <Td>
                        {v.lead && <Link className="text-brand-700 hover:underline" href={`/crm/leads/${v.lead.id}`}>{v.lead.name}</Link>}
                        {v.client && <Link className="text-brand-700 hover:underline" href={`/crm/clients/${v.client.id}`}>{v.client.name}</Link>}
                      </Td>
                      <Td className="max-w-xs truncate">{v.siteAddress}</Td>
                      <Td right>{v.estimatedArea ? `${Number(v.estimatedArea)} sq ft` : "—"}</Td>
                      <Td>{v.assignedToId ? nameOf.get(v.assignedToId) ?? "—" : "—"}</Td>
                      <Td>{v.completed ? <Badge tone="green">Completed</Badge> : late ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Scheduled</Badge>}</Td>
                      {canEdit && (
                        <Td right>
                          <div className="flex justify-end gap-1">
                            <FormDialog
                              title="Site visit details"
                              wide
                              trigger={<Button size="sm" variant="ghost">{v.completed ? "View / edit" : "Record"}</Button>}
                              fields={siteVisitFields({ users, leadOptions: leadOpts, clientOptions: clients, visit: v as unknown as Record<string, unknown> })}
                              action={updateSiteVisit.bind(null, v.id)}
                            />
                            {!v.completed && <ActionButton size="sm" variant="secondary" action={completeSiteVisit.bind(null, v.id)}>Mark done</ActionButton>}
                            <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteSiteVisit.bind(null, v.id)} confirm={{ title: "Delete this site visit?", confirmLabel: "Delete" }}>Delete</ActionButton>
                          </div>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/crm/site-visits" />
          </>
        )}
      </Card>
    </>
  );
}
