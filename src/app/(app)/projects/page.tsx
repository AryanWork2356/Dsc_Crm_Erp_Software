import Link from "next/link";
import type { Prisma, ProjectStatus, SegmentType } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten, listParams } from "@/lib/list";
import { PROJECT_STATUS_OPTS, SEGMENT_OPTS } from "@/lib/enums";
import { PM_ROLES, clientOptions, userOptions } from "@/lib/lookups";
import { projectFinancials } from "@/lib/project-finance";
import { formatDate, formatINR, humanize, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState, Progress, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, Pagination } from "@/components/ui/table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog } from "@/components/forms/form-dialog";
import { createProject } from "./actions";
import { projectFields } from "./project-fields";

export const metadata = { title: "Projects" };

const ACTIVE: ProjectStatus[] = ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"];

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("projects:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "createdAt", "desc", 20);
  const today = startOfDay();
  const scope = projectScope(c);
  const showMoney = c.can("margins:view");

  const where: Prisma.ProjectWhereInput = {
    AND: [
      scope,
      {
        ...(sp.status === "active" ? { status: { in: ACTIVE } } : sp.status ? { status: sp.status as ProjectStatus } : {}),
        ...(sp.segment ? { segment: sp.segment as SegmentType } : {}),
        ...(sp.pm ? { projectManagerId: sp.pm } : {}),
        ...(sp.client ? { clientId: sp.client } : {}),
        ...(sp.delayed ? { plannedEndDate: { lt: today }, status: { in: ACTIVE } } : {}),
        ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { code: { contains: lp.q, mode: "insensitive" } }, { client: { name: { contains: lp.q, mode: "insensitive" } } }, { siteAddress: { contains: lp.q, mode: "insensitive" } }] } : {}),
      },
    ],
  };

  const [rows, total, pms, clients, kActive, kDone, kDelayed, kSoon] = await Promise.all([
    db.project.findMany({ where, include: { client: { select: { name: true } } }, orderBy: { [["createdAt", "name", "plannedEndDate", "progress"].includes(lp.sort) ? lp.sort : "createdAt"]: lp.dir }, skip: lp.skip, take: lp.take }),
    db.project.count({ where }),
    userOptions(c.companyId, PM_ROLES),
    clientOptions(c.companyId),
    db.project.count({ where: { AND: [scope, { status: { in: ACTIVE } }] } }),
    db.project.count({ where: { AND: [scope, { status: "COMPLETED" }] } }),
    db.project.count({ where: { AND: [scope, { status: { in: ACTIVE }, plannedEndDate: { lt: today } }] } }),
    db.project.count({ where: { AND: [scope, { status: { in: ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT"] }, startDate: { gte: today, lt: new Date(today.getTime() + 15 * 86400000) } }] } }),
  ]);
  const fin = showMoney ? await projectFinancials(c.companyId, rows.map((r) => r.id)) : new Map();
  const staff = await userOptions(c.companyId);
  const pmName = new Map(pms.map((p) => [p.value, p.label]));

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Every job from approval to handover."
        actions={c.can("projects:create") && <FormDialog title="New project" wide trigger={<Button>New project</Button>} fields={projectFields({ clients, pms, staff, showMoney })} action={createProject} successMessage="Project created" />}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active projects" value={kActive} href="/projects?status=active" />
        <StatCard label="Delayed" value={kDelayed} tone={kDelayed ? "bad" : "default"} href="/projects?delayed=1" />
        <StatCard label="Starting in 15 days" value={kSoon} />
        <StatCard label="Completed" value={kDone} tone="good" href="/projects?status=COMPLETED" />
      </div>
      <Card>
        <ListFilters
          placeholder="Search project, client, address…"
          filters={[
            { key: "status", label: "Status", options: [{ value: "active", label: "All active" }, ...PROJECT_STATUS_OPTS] },
            { key: "segment", label: "Segment", options: SEGMENT_OPTS },
            { key: "pm", label: "Manager", options: pms },
            { key: "client", label: "Client", options: clients },
          ]}
        />
        {rows.length === 0 ? (
          <EmptyState title="No projects found" hint="Convert an accepted quotation, or create a project directly." />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Project</Th><Th>Manager</Th><Th>Status</Th><Th className="min-w-[140px]">Progress</Th><Th>Due</Th>
                  {showMoney && <><Th right>Contract</Th><Th right>Margin</Th></>}
                </tr>
              </THead>
              <tbody>
                {rows.map((p) => {
                  const f = fin.get(p.id);
                  const late = p.plannedEndDate && p.plannedEndDate < today && ACTIVE.includes(p.status);
                  return (
                    <Tr key={p.id}>
                      <Td>
                        <Link href={`/projects/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.name}</Link>
                        <p className="text-xs text-slate-500">{p.code} · {p.client.name} · {humanize(p.segment)}</p>
                      </Td>
                      <Td>{p.projectManagerId ? pmName.get(p.projectManagerId) ?? "—" : "—"}</Td>
                      <Td><StatusBadge status={p.status} /></Td>
                      <Td><div className="flex items-center gap-2"><Progress value={p.progress} className="w-24" /><span className="tabular text-xs text-slate-600">{p.progress}%</span></div></Td>
                      <Td className={cn("whitespace-nowrap", late && "font-medium text-red-600")}>{formatDate(p.plannedEndDate)}{late && <Badge tone="red" className="ml-1.5">Delayed</Badge>}</Td>
                      {showMoney && (
                        <>
                          <Td right>{formatINR(p.contractValue)}</Td>
                          <Td right className={cn(f && f.contractValue > 0 && f.marginPct < 15 ? "font-medium text-red-600" : "text-emerald-700")}>{f && f.actualCost > 0 ? `${f.marginPct.toFixed(1)}%` : "—"}</Td>
                        </>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/projects" />
          </>
        )}
      </Card>
    </>
  );
}
