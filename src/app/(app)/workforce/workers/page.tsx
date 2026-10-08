import Link from "next/link";
import type { Prisma, WorkerTrade } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { flatten, listParams, orderBy } from "@/lib/list";
import { WORKER_TRADE_OPTS } from "@/lib/enums";
import { projectOptions } from "@/lib/lookups";
import { calendarDay, formatDate, formatINR, humanize, num } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td, SortTh, Pagination } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/components/list/list-filters";
import { FormDialog, type FieldDef } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { createWorker, createWorkerLogin, deleteWorker, setWorkerActive, updateWorker } from "../actions";

export const metadata = { title: "Workers" };

export default async function WorkersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("workers:view");
  const sp = flatten(await searchParams);
  const lp = listParams(sp, "name", "asc", 25);
  const money = c.can("salary:view") || c.role === "SITE_ENGINEER" || c.role === "SITE_SUPERVISOR" ? c.can("salary:view") : false;
  const where: Prisma.WorkerWhereInput = {
    companyId: c.companyId, deletedAt: null,
    ...(sp.trade ? { trade: sp.trade as WorkerTrade } : {}),
    ...(sp.contractor ? { contractorId: sp.contractor } : {}),
    ...(sp.project ? { currentProjectId: sp.project } : {}),
    ...(sp.status === "inactive" ? { isActive: false } : sp.status === "all" ? {} : { isActive: true }),
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { code: { contains: lp.q, mode: "insensitive" } }, { phone: { contains: lp.q } }] } : {}),
  };
  const [rows, total, contractors, projects, activeCount, todayPresent, logins] = await Promise.all([
    db.worker.findMany({ where, include: { contractor: { select: { name: true } } }, orderBy: orderBy(lp.sort, lp.dir, ["name", "code", "trade", "joiningDate"] as const, "name"), skip: lp.skip, take: lp.take }),
    db.worker.count({ where }),
    db.contractor.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    projectOptions(c.companyId),
    db.worker.count({ where: { companyId: c.companyId, deletedAt: null, isActive: true } }),
    db.attendance.count({ where: { companyId: c.companyId, workerId: { not: null }, date: calendarDay(), status: { in: ["PRESENT", "OVERTIME", "HALF_DAY"] } } }),
    db.user.findMany({ where: { companyId: c.companyId, workerId: { not: null } }, select: { workerId: true, email: true } }),
  ]);
  const pn = new Map(projects.map((p) => [p.value, p.label]));
  const login = new Map(logins.map((l) => [l.workerId, l.email]));
  const canEdit = c.can("workers:edit");

  const fields = (w?: (typeof rows)[number]): FieldDef[] => [
    { name: "name", label: "Full name", required: true, full: true, defaultValue: w?.name ?? null },
    { name: "phone", label: "Phone", type: "tel", defaultValue: w?.phone ?? null },
    { name: "trade", label: "Trade", type: "select", required: true, options: WORKER_TRADE_OPTS, defaultValue: w?.trade ?? "HELPER" },
    { name: "skill", label: "Skill notes", defaultValue: w?.skill ?? null },
    { name: "contractorId", label: "Contractor (if any)", type: "select", options: contractors.map((x) => ({ value: x.id, label: x.name })), defaultValue: w?.contractorId ?? null },
    { name: "currentProjectId", label: "Assigned site", type: "select", options: projects, defaultValue: w?.currentProjectId ?? null },
    { name: "wageType", label: "Paid", type: "select", required: true, options: [{ value: "DAILY", label: "Per day" }, { value: "MONTHLY", label: "Per month" }, { value: "CONTRACT", label: "Through contractor" }], defaultValue: w?.wageType ?? "DAILY" },
    ...(money ? [{ name: "dailyWage", label: "Daily wage (₹)", type: "number" as const, defaultValue: w ? num(w.dailyWage) : 0 }, { name: "monthlyWage", label: "Monthly wage (₹)", type: "number" as const, defaultValue: w ? num(w.monthlyWage) : 0 }] : []),
    { name: "joiningDate", label: "Joining date", type: "date", defaultValue: w?.joiningDate?.toISOString().slice(0, 10) ?? null },
    { name: "emergencyContact", label: "Emergency contact", defaultValue: w?.emergencyContact ?? null },
  ];

  return (
    <>
      <PageHeader title="Workers" subtitle="Site labour: carpenters, electricians, painters and helpers." actions={c.can("workers:create") && <FormDialog title="Add worker" wide trigger={<Button>Add worker</Button>} fields={fields()} action={createWorker} successMessage="Worker added" />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Active workers" value={activeCount} />
        <StatCard label="Present today" value={todayPresent} tone="good" href="/workforce/attendance" />
        <StatCard label="Contractors" value={contractors.length} href="/workforce/contractors" />
      </div>
      <Card>
        <ListFilters placeholder="Search name, ID or phone…" filters={[{ key: "trade", label: "Trade", options: WORKER_TRADE_OPTS }, { key: "contractor", label: "Contractor", options: contractors.map((x) => ({ value: x.id, label: x.name })) }, { key: "project", label: "Site", options: projects }, { key: "status", label: "Status", options: [{ value: "inactive", label: "Inactive" }, { value: "all", label: "All" }] }]} />
        {rows.length === 0 ? <EmptyState title="No workers found" /> : (
          <>
            <Table>
              <THead><tr><SortTh label="Worker" field="name" sp={sp} basePath="/workforce/workers" /><SortTh label="Trade" field="trade" sp={sp} basePath="/workforce/workers" /><Th>Contractor</Th><Th>Site</Th><Th>Phone</Th>{money && <Th right>Wage</Th>}<Th>Login</Th><Th>Status</Th>{canEdit && <Th right>Actions</Th>}</tr></THead>
              <tbody>
                {rows.map((w) => (
                  <Tr key={w.id}>
                    <Td><p className="font-medium text-slate-900">{w.name}</p><p className="text-xs text-slate-500">{w.code}{w.joiningDate ? ` · since ${formatDate(w.joiningDate)}` : ""}</p></Td>
                    <Td>{humanize(w.trade)}</Td>
                    <Td>{w.contractor ? <Link className="text-brand-700 hover:underline" href={`/workforce/contractors/${w.contractorId}`}>{w.contractor.name}</Link> : "—"}</Td>
                    <Td className="max-w-[180px] truncate text-xs">{w.currentProjectId ? pn.get(w.currentProjectId) ?? "—" : "—"}</Td>
                    <Td>{w.phone ?? "—"}</Td>
                    {money && <Td right>{w.wageType === "DAILY" ? `${formatINR(w.dailyWage)}/day` : w.wageType === "MONTHLY" ? `${formatINR(w.monthlyWage)}/mo` : "Contract"}</Td>}
                    <Td className="text-xs">{login.get(w.id) ?? "—"}</Td>
                    <Td>{w.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}</Td>
                    {canEdit && (
                      <Td right>
                        <div className="flex justify-end gap-1">
                          <FormDialog title={`Edit ${w.name}`} wide trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={fields(w)} action={updateWorker.bind(null, w.id)} />
                          {c.can("users:manage") && <FormDialog title={`Phone login – ${w.name}`} description="Gives the worker access to the simple mobile screen (attendance, tasks)." trigger={<Button size="sm" variant="ghost">{login.has(w.id) ? "Reset login" : "Create login"}</Button>} fields={[{ name: "password", label: "Password", type: "password", required: true, hint: "At least 6 characters" }]} action={createWorkerLogin.bind(null, w.id)} submitLabel="Save" />}
                          <ActionButton size="sm" variant="ghost" action={setWorkerActive.bind(null, w.id, !w.isActive)}>{w.isActive ? "Deactivate" : "Reactivate"}</ActionButton>
                          {c.can("workers:delete") && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteWorker.bind(null, w.id)} confirm={{ title: `Delete ${w.name}?`, body: "Only possible if they have no attendance history.", confirmLabel: "Delete" }}>Delete</ActionButton>}
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/workforce/workers" />
          </>
        )}
      </Card>
    </>
  );
}
