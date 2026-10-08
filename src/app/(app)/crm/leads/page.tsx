import Link from "next/link";
import type { Prisma, LeadStage, Priority, SegmentType } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/scope";
import { flatten, listParams, orderBy } from "@/lib/list";
import { LEAD_SOURCE_OPTS, LEAD_STAGES, LEAD_STAGE_OPTS, OPEN_LEAD_STAGES, PRIORITY_OPTS, SEGMENT_OPTS } from "@/lib/enums";
import { SALES_ROLES, userOptions } from "@/lib/lookups";
import { formatDate, formatINR, humanize, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Tr, Td, Th, SortTh, Pagination } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { createLead, changeLeadStage } from "../actions";
import { leadFields } from "./lead-fields";
import { Kanban, type KLead } from "./kanban";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("leads:view");
  const sp = flatten(await searchParams);
  const view = sp.view === "board" ? "board" : "table";
  const lp = listParams(sp, "createdAt", "desc", 20);
  const today = startOfDay();

  const where: Prisma.LeadWhereInput = {
    ...leadScope(c),
    ...(sp.stage ? { stage: sp.stage as LeadStage } : {}),
    ...(sp.segment ? { segment: sp.segment as SegmentType } : {}),
    ...(sp.priority ? { priority: sp.priority as Priority } : {}),
    ...(sp.source ? { source: sp.source } : {}),
    ...(sp.assignee ? { assignedToId: sp.assignee } : {}),
    ...(sp.followup === "overdue" ? { nextFollowUp: { lt: today }, stage: { notIn: ["WON", "LOST"] } } : {}),
    ...(sp.followup === "today" ? { nextFollowUp: { gte: today, lt: new Date(today.getTime() + 86400000) } } : {}),
    ...(lp.q
      ? { OR: [
          { name: { contains: lp.q, mode: "insensitive" } }, { companyName: { contains: lp.q, mode: "insensitive" } },
          { phone: { contains: lp.q } }, { code: { contains: lp.q, mode: "insensitive" } },
          { location: { contains: lp.q, mode: "insensitive" } }, { email: { contains: lp.q, mode: "insensitive" } },
        ] }
      : {}),
  };

  const users = await userOptions(c.companyId, SALES_ROLES);
  const nameOf = new Map(users.map((u) => [u.value, u.label]));
  const canAssign = c.role !== "SALES";

  const [kpiOpen, kpiValue, kpiWon, kpiOverdue] = await Promise.all([
    db.lead.count({ where: { ...leadScope(c), stage: { in: [...OPEN_LEAD_STAGES] } } }),
    db.lead.aggregate({ where: { ...leadScope(c), stage: { in: [...OPEN_LEAD_STAGES] } }, _sum: { estimatedValue: true } }),
    db.lead.count({ where: { ...leadScope(c), stage: "WON" } }),
    db.lead.count({ where: { ...leadScope(c), nextFollowUp: { lt: today }, stage: { notIn: ["WON", "LOST"] } } }),
  ]);
  const totalAll = await db.lead.count({ where: leadScope(c) });

  let body: React.ReactNode;
  if (view === "board") {
    const boardLeads = await db.lead.findMany({ where, orderBy: { updatedAt: "desc" }, take: 400 });
    const k: KLead[] = boardLeads.map((l) => ({
      id: l.id, code: l.code, name: l.name, companyName: l.companyName, stage: l.stage, value: Number(l.estimatedValue ?? 0),
      priority: l.priority, assignee: l.assignedToId ? nameOf.get(l.assignedToId) ?? null : null,
      nextFollowUp: l.nextFollowUp?.toISOString() ?? null, overdue: !!l.nextFollowUp && l.nextFollowUp < today && l.stage !== "WON" && l.stage !== "LOST",
    }));
    body = <div className="p-4"><Kanban stages={[...LEAD_STAGES]} leads={k} canMove={c.can("leads:edit")} move={changeLeadStage} /></div>;
  } else {
    const sortable = ["createdAt", "name", "estimatedValue", "nextFollowUp", "stage"] as const;
    const [rows, total] = await Promise.all([
      db.lead.findMany({ where, orderBy: orderBy(lp.sort, lp.dir, sortable, "createdAt"), skip: lp.skip, take: lp.take }),
      db.lead.count({ where }),
    ]);
    body = rows.length === 0 ? (
      <EmptyState
        title={totalAll === 0 ? "No leads yet" : "No leads match these filters"}
        hint={totalAll === 0 ? "Add your first enquiry to start the pipeline." : "Try clearing some filters."}
        action={totalAll === 0 && c.can("leads:create") ? <FormDialog title="New lead" wide trigger={<Button>Add lead</Button>} fields={leadFields(users, null, canAssign)} action={createLead} successMessage="Lead created" /> : undefined}
      />
    ) : (
      <>
        <Table>
          <THead>
            <tr>
              <Th>Lead</Th>
              <Th>Phone</Th>
              <Th>Segment</Th>
              <SortTh label="Value" field="estimatedValue" sp={sp} basePath="/crm/leads" right />
              <SortTh label="Stage" field="stage" sp={sp} basePath="/crm/leads" />
              <Th>Owner</Th>
              <SortTh label="Follow-up" field="nextFollowUp" sp={sp} basePath="/crm/leads" />
            </tr>
          </THead>
          <tbody>
            {rows.map((l) => {
              const overdue = l.nextFollowUp && l.nextFollowUp < today && l.stage !== "WON" && l.stage !== "LOST";
              return (
                <Tr key={l.id}>
                  <Td>
                    <Link href={`/crm/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-700">{l.name}</Link>
                    <p className="text-xs text-slate-500">{l.code}{l.companyName ? ` · ${l.companyName}` : ""}</p>
                  </Td>
                  <Td>{l.phone ?? "—"}</Td>
                  <Td>{humanize(l.segment)}</Td>
                  <Td right>{l.estimatedValue ? formatINR(l.estimatedValue) : "—"}</Td>
                  <Td><StatusBadge status={l.stage} /></Td>
                  <Td>{l.assignedToId ? nameOf.get(l.assignedToId) ?? "—" : <span className="text-amber-600">Unassigned</span>}</Td>
                  <Td className={cn(overdue && "font-medium text-red-600")}>{l.nextFollowUp ? formatDate(l.nextFollowUp) : "—"}{overdue ? " · overdue" : ""}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/crm/leads" />
      </>
    );
  }

  const toggle = (v: string) => {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(sp)) if (val && k !== "view" && k !== "page") q.set(k, val);
    q.set("view", v);
    return `/crm/leads?${q}`;
  };

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Every enquiry from first contact to won or lost."
        actions={
          <>
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm shadow-sm">
              <Link href={toggle("table")} className={cn("rounded-md px-3 py-1.5", view === "table" ? "bg-brand-800 text-white" : "text-slate-600")}>List</Link>
              <Link href={toggle("board")} className={cn("rounded-md px-3 py-1.5", view === "board" ? "bg-brand-800 text-white" : "text-slate-600")}>Pipeline</Link>
            </div>
            {c.can("leads:create") && (
              <FormDialog title="New lead" wide trigger={<Button>Add lead</Button>} fields={leadFields(users, null, canAssign)} action={createLead} successMessage="Lead created" />
            )}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open leads" value={kpiOpen} />
        <StatCard label="Pipeline value" value={formatINR(kpiValue._sum.estimatedValue)} />
        <StatCard label="Won" value={kpiWon} tone="good" />
        <StatCard label="Follow-ups overdue" value={kpiOverdue} tone={kpiOverdue ? "bad" : "default"} href="/crm/leads?followup=overdue" />
      </div>
      <Card>
        <ListFilters
          placeholder="Search name, phone, location…"
          exportHref="/crm/leads/export"
          filters={[
            { key: "stage", label: "Stage", options: LEAD_STAGE_OPTS },
            { key: "segment", label: "Segment", options: SEGMENT_OPTS },
            { key: "source", label: "Source", options: LEAD_SOURCE_OPTS },
            { key: "priority", label: "Priority", options: PRIORITY_OPTS },
            ...(canAssign ? [{ key: "assignee", label: "Owner", options: users }] : []),
            { key: "followup", label: "Follow-up", options: [{ value: "overdue", label: "Overdue" }, { value: "today", label: "Today" }] },
          ]}
        />
        {body}
      </Card>
    </>
  );
}
