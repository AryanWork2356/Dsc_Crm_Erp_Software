import Link from "next/link";
import type { Prisma, TaskStatus } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten, listParams } from "@/lib/list";
import { TASK_STATUS_OPTS } from "@/lib/enums";
import { userOptions } from "@/lib/lookups";
import { formatDate, startOfDay, cn } from "@/lib/utils";
import { PageHeader, EmptyState, TabLinks } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Pagination } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";
import { ListFilters } from "@/components/list/list-filters";
import { TaskStatusControl } from "../task-controls";
import { setTaskStatus } from "../actions";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("tasks:view");
  const sp = flatten(await searchParams);
  const scope = sp.scope === "all" && c.role !== "SITE_ENGINEER" && c.role !== "SITE_SUPERVISOR" && c.role !== "DESIGNER" ? "all" : "mine";
  const lp = listParams(sp, "dueDate", "asc", 25);
  const today = startOfDay();

  const projects = await db.project.findMany({ where: projectScope(c), select: { id: true } });
  const where: Prisma.ProjectTaskWhereInput = {
    companyId: c.companyId,
    projectId: { in: projects.map((p) => p.id) },
    ...(scope === "mine" ? { assignedToId: c.userId } : {}),
    ...(sp.status === "open" || !sp.status ? { status: { not: "COMPLETED" } } : sp.status === "all" ? {} : { status: sp.status as TaskStatus }),
    ...(sp.overdue ? { dueDate: { lt: today }, status: { not: "COMPLETED" } } : {}),
    ...(lp.q ? { OR: [{ name: { contains: lp.q, mode: "insensitive" } }, { project: { name: { contains: lp.q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total, staff] = await Promise.all([
    db.projectTask.findMany({ where, include: { project: { select: { id: true, name: true, code: true } } }, orderBy: [{ dueDate: { sort: lp.dir, nulls: "last" } }, { createdAt: "desc" }], skip: lp.skip, take: lp.take }),
    db.projectTask.count({ where }),
    userOptions(c.companyId),
  ]);
  const name = new Map(staff.map((s) => [s.value, s.label]));

  return (
    <>
      <PageHeader title="Tasks" subtitle={scope === "mine" ? "Tasks assigned to you." : "Tasks across the projects you can see."} />
      <TabLinks current={scope} tabs={[{ key: "mine", label: "My tasks", href: "/projects/tasks" }, ...(["OWNER", "MANAGEMENT", "ADMIN", "PROJECT_MANAGER"].includes(c.role) ? [{ key: "all", label: "All tasks", href: "/projects/tasks?scope=all" }] : [])]} />
      <Card>
        <ListFilters placeholder="Search task or project…" filters={[
          { key: "status", label: "Status", options: [{ value: "open", label: "Open (not completed)" }, { value: "all", label: "Everything" }, ...TASK_STATUS_OPTS] },
          { key: "overdue", label: "Due", options: [{ value: "1", label: "Overdue only" }] },
        ]} />
        {rows.length === 0 ? (
          <EmptyState title="No tasks" hint={scope === "mine" ? "Nothing is assigned to you right now." : "No tasks match these filters."} />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {rows.map((t) => {
                const over = t.dueDate && t.dueDate < today && t.status !== "COMPLETED";
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{t.name}</p>
                      <p className="text-xs text-slate-500">
                        <Link href={`/projects/${t.project.id}?tab=tasks`} className="text-brand-700 hover:underline">{t.project.code} · {t.project.name}</Link>
                        {scope === "all" && ` · ${t.assignedToId ? name.get(t.assignedToId) ?? "—" : "Unassigned"}`} · due <span className={cn(over && "font-medium text-red-600")}>{formatDate(t.dueDate)}</span>
                      </p>
                    </div>
                    {(t.priority === "HIGH" || t.priority === "URGENT") && <StatusBadge status={t.priority} />}
                    <TaskStatusControl status={t.status} progress={t.progress} disabled={!c.can("tasks:edit")} action={setTaskStatus.bind(null, t.id)} />
                  </li>
                );
              })}
            </ul>
            <Pagination total={total} page={lp.page} pageSize={lp.pageSize} sp={sp} basePath="/projects/tasks" />
          </>
        )}
      </Card>
    </>
  );
}
