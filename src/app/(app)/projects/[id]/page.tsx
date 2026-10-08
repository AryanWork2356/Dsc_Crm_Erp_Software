import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Check, Circle } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectDocScope, projectScope } from "@/lib/scope";
import { PM_ROLES, clientOptions, userOptions } from "@/lib/lookups";
import { PROJECT_STATUS_OPTS, PRIORITY_OPTS } from "@/lib/enums";
import { oneProjectFinancials } from "@/lib/project-finance";
import { projectMaterialPlan } from "@/lib/project-materials";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { formatDate, formatINR, humanize, num, startOfDay, toDateInput, cn } from "@/lib/utils";
import { PageHeader, TabLinks, StatCard, DetailGrid, Progress, EmptyState, Alert } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { StageSelect } from "../../crm/leads/[id]/stage-select";
import { projectFields } from "../project-fields";
import { TaskStatusControl } from "../task-controls";
import { addTaskComment, changeProjectStatus, createMilestone, createTask, deleteMilestone, deleteProject, deleteTask, setTaskStatus, syncBudgetFromBoq, toggleMilestone, updateMilestone, updateProject, updateTask } from "../actions";

const ACTIVE = ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"];

export default async function ProjectDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const c = await requirePerm("projects:view");
  const p = await db.project.findFirst({
    where: { id, ...projectScope(c) },
    include: {
      client: true,
      tasks: { orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], include: { comments: { orderBy: { createdAt: "asc" } } } },
      milestones: { orderBy: [{ dueDate: "asc" }, { name: "asc" }] },
      boqs: { where: { deletedAt: null }, orderBy: { revision: "desc" }, include: { items: { select: { estimatedCost: true, total: true } } } },
    },
  });
  if (!p) notFound();

  const money = c.can("margins:view");
  const docAccess = !!(await db.project.findFirst({ where: { id, ...projectDocScope(c) }, select: { id: true } }));
  const tabs = [
    { key: "overview", label: "Overview", href: `/projects/${id}` },
    { key: "tasks", label: "Tasks", href: `/projects/${id}?tab=tasks`, count: p.tasks.length },
    { key: "timeline", label: "Timeline", href: `/projects/${id}?tab=timeline` },
    { key: "milestones", label: "Milestones", href: `/projects/${id}?tab=milestones`, count: p.milestones.length },
    { key: "boq", label: "BOQ", href: `/projects/${id}?tab=boq`, count: p.boqs.length },
    ...(c.can("inventory:view") ? [{ key: "materials", label: "Materials", href: `/projects/${id}?tab=materials` }] : []),
    ...(c.can("documents:view") && docAccess ? [{ key: "documents", label: "Documents", href: `/projects/${id}?tab=documents` }] : []),
    ...(money ? [{ key: "financials", label: "Profit & budget", href: `/projects/${id}?tab=financials` }] : []),
  ];
  const tab = tabs.some((t) => t.key === tabParam) ? tabParam! : "overview";

  const [staff, pms, clients, fin] = await Promise.all([
    userOptions(c.companyId),
    userOptions(c.companyId, PM_ROLES),
    c.can("projects:edit") ? clientOptions(c.companyId) : [],
    money ? oneProjectFinancials(c.companyId, id) : null,
  ]);
  const plan = tab === "materials" ? await projectMaterialPlan(c.companyId, id) : [];
  const name = new Map(staff.map((s) => [s.value, s.label]));
  const today = startOfDay();
  const late = p.plannedEndDate && p.plannedEndDate < today && ACTIVE.includes(p.status);
  const canEdit = c.can("projects:edit");
  const canTask = c.can("tasks:create");

  const taskFields = (t?: (typeof p.tasks)[number]) => [
    { name: "name", label: "Task", required: true, full: true, defaultValue: t?.name ?? null },
    { name: "assignedToId", label: "Assigned to", type: "select" as const, options: staff, defaultValue: t?.assignedToId ?? null },
    { name: "priority", label: "Priority", type: "select" as const, options: PRIORITY_OPTS, defaultValue: t?.priority ?? "MEDIUM" },
    { name: "startDate", label: "Start", type: "date" as const, defaultValue: toDateInput(t?.startDate) },
    { name: "dueDate", label: "Due", type: "date" as const, defaultValue: toDateInput(t?.dueDate) },
    { name: "dependsOnId", label: "Depends on", type: "select" as const, options: p.tasks.filter((x) => x.id !== t?.id).map((x) => ({ value: x.id, label: x.name })), defaultValue: t?.dependsOnId ?? null },
    { name: "description", label: "Details", type: "textarea" as const, defaultValue: t?.description ?? null },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/projects", label: "All projects" }}
        title={p.name}
        subtitle={<>{p.code} · <Link className="text-brand-700 hover:underline" href={`/crm/clients/${p.clientId}`}>{p.client.name}</Link> · {humanize(p.segment)}</>}
        actions={
          <>
            {canEdit ? (
              <StageSelect current={p.status} options={PROJECT_STATUS_OPTS} action={async (s) => { "use server"; return changeProjectStatus(id, s); }} />
            ) : <StatusBadge status={p.status} />}
            {canEdit && <FormDialog title="Edit project" wide trigger={<Button variant="secondary">Edit</Button>} fields={projectFields({ clients, pms, staff, showMoney: money, project: p as unknown as Record<string, unknown> })} action={updateProject.bind(null, id)} />}
          </>
        }
      />
      {late && <div className="mb-4"><Alert tone="bad">Planned completion was {formatDate(p.plannedEndDate)} – this project is delayed.</Alert></div>}
      {fin?.overBudget && <div className="mb-4"><Alert tone="warn">Actual cost is <b>{formatINR(fin.variance)}</b> ({fin.variancePct.toFixed(1)}%) over the budget.</Alert></div>}

      <TabLinks tabs={tabs} current={tab} />

      {tab === "overview" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Progress" value={`${p.progress}%`} sub={<Progress value={p.progress} className="mt-2" />} />
            <StatCard label="Planned completion" value={formatDate(p.plannedEndDate)} tone={late ? "bad" : "default"} />
            {money && <StatCard label="Contract value" value={formatINR(p.contractValue)} />}
            {money && fin && <StatCard label="Margin so far" value={fin.actualCost > 0 ? `${fin.marginPct.toFixed(1)}%` : "—"} tone={fin.actualCost > 0 && fin.marginPct < 15 ? "bad" : "good"} sub={`Actual cost ${formatINR(fin.actualCost)}`} />}
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Project details</CardTitle></CardHeader>
              <CardBody>
                <DetailGrid items={[
                  { label: "Site address", value: p.siteAddress }, { label: "Start date", value: formatDate(p.startDate) }, { label: "Actual completion", value: formatDate(p.actualEndDate) },
                  { label: "Project manager", value: p.projectManagerId ? name.get(p.projectManagerId) : null }, { label: "Designer", value: p.designerId ? name.get(p.designerId) : null },
                  { label: "Site engineer", value: p.siteEngineerId ? name.get(p.siteEngineerId) : null }, { label: "Supervisor", value: p.supervisorId ? name.get(p.supervisorId) : null },
                ]} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader><CardTitle>Upcoming</CardTitle></CardHeader>
              <CardBody className="space-y-3 py-3 text-sm">
                {p.milestones.filter((m) => !m.completedAt).slice(0, 3).map((m) => (
                  <div key={m.id} className="flex justify-between"><span>{m.name}</span><span className={cn("text-slate-500", m.dueDate && m.dueDate < today && "font-medium text-red-600")}>{formatDate(m.dueDate)}</span></div>
                ))}
                {p.tasks.filter((t) => t.status !== "COMPLETED" && t.dueDate).sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime()).slice(0, 4).map((t) => (
                  <div key={t.id} className="flex justify-between"><span className="truncate pr-2">{t.name}</span><span className={cn("shrink-0 text-slate-500", t.dueDate! < today && "font-medium text-red-600")}>{formatDate(t.dueDate)}</span></div>
                ))}
                {p.milestones.length + p.tasks.length === 0 && <p className="text-slate-500">Add tasks and milestones to plan this project.</p>}
              </CardBody>
            </Card>
          </div>
          {c.can("projects:delete") && (
            <ActionButton variant="ghost" className="text-red-600 hover:bg-red-50" action={async () => { "use server"; const r = await deleteProject(id); if (r.ok) redirect("/projects"); return r; }} confirm={{ title: "Delete this project?", body: "Only possible if there are no invoices, purchase orders, expenses or site records.", confirmLabel: "Delete project" }}>Delete project</ActionButton>
          )}
        </div>
      )}

      {tab === "tasks" && (
        <Card>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            {canTask && <FormDialog title="New task" wide trigger={<Button size="sm">Add task</Button>} fields={taskFields()} action={async (fd) => { "use server"; return createTask(id, fd); }} />}
          </CardHeader>
          {p.tasks.length === 0 ? <EmptyState title="No tasks yet" hint="Break the job into tasks and assign them to your team." /> : (
            <ul className="divide-y divide-slate-100">
              {p.tasks.map((t) => {
                const over = t.dueDate && t.dueDate < today && t.status !== "COMPLETED";
                return (
                  <li key={t.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900">{t.name} <span className="text-xs font-normal text-slate-400">{t.code}</span></p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {t.assignedToId ? name.get(t.assignedToId) ?? "—" : "Unassigned"} · due <span className={cn(over && "font-medium text-red-600")}>{formatDate(t.dueDate)}</span>{over && " (overdue)"}
                          {t.dependsOnId && ` · after “${p.tasks.find((x) => x.id === t.dependsOnId)?.name ?? "…"}”`}
                        </p>
                      </div>
                      {(t.priority === "HIGH" || t.priority === "URGENT") && <StatusBadge status={t.priority} />}
                      <TaskStatusControl status={t.status} progress={t.progress} disabled={!c.can("tasks:edit")} action={setTaskStatus.bind(null, t.id)} />
                      {c.can("tasks:edit") && <FormDialog title="Edit task" wide trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={taskFields(t)} action={updateTask.bind(null, t.id)} />}
                      {c.can("tasks:delete") && <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteTask.bind(null, t.id)} confirm={{ title: `Delete “${t.name}”?`, confirmLabel: "Delete" }}>Delete</ActionButton>}
                    </div>
                    {(t.comments.length > 0 || c.can("tasks:edit")) && (
                      <div className="mt-2 pl-0 text-sm">
                        {t.comments.map((cm) => <p key={cm.id} className="text-slate-600">💬 <span className="font-medium">{name.get(cm.userId) ?? "User"}:</span> {cm.body}</p>)}
                        {c.can("tasks:edit") && <FormDialog title="Add comment" trigger={<button className="mt-1 text-xs font-medium text-brand-700 hover:underline">Add comment</button>} fields={[{ name: "body", label: "Comment", type: "textarea", required: true }]} action={addTaskComment.bind(null, t.id)} submitLabel="Post" />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "timeline" && <Timeline p={p} today={today} />}

      {tab === "milestones" && (
        <Card>
          <CardHeader>
            <CardTitle>Milestones</CardTitle>
            {canEdit && <FormDialog title="New milestone" trigger={<Button size="sm">Add milestone</Button>} fields={[{ name: "name", label: "Milestone", required: true, full: true, placeholder: "e.g. Carcass complete" }, { name: "dueDate", label: "Due date", type: "date" }, ...(money ? [{ name: "billingPct", label: "Bill % of contract", type: "number" as const, hint: "Used to raise stage-wise invoices" }] : [])]} action={createMilestone.bind(null, id)} />}
          </CardHeader>
          {p.milestones.length === 0 ? <EmptyState title="No milestones" hint="Milestones track key stages and can trigger stage-wise billing." /> : (
            <ul className="divide-y divide-slate-100">
              {p.milestones.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  {m.completedAt ? <Check className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                  <div className="min-w-0 flex-1">
                    <p className={cn("font-medium", m.completedAt ? "text-slate-500 line-through" : "text-slate-900")}>{m.name}</p>
                    <p className="text-xs text-slate-500">Due {formatDate(m.dueDate)}{m.completedAt && ` · done ${formatDate(m.completedAt)}`}{money && num(m.billingPct) > 0 && ` · bill ${num(m.billingPct)}% = ${formatINR((num(p.contractValue) * num(m.billingPct)) / 100)}`}</p>
                  </div>
                  {canEdit && (
                    <>
                      <ActionButton size="sm" variant={m.completedAt ? "ghost" : "secondary"} action={toggleMilestone.bind(null, m.id)}>{m.completedAt ? "Reopen" : "Mark done"}</ActionButton>
                      <FormDialog title="Edit milestone" trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={[{ name: "name", label: "Milestone", required: true, full: true, defaultValue: m.name }, { name: "dueDate", label: "Due date", type: "date", defaultValue: toDateInput(m.dueDate) }, ...(money ? [{ name: "billingPct", label: "Bill % of contract", type: "number" as const, defaultValue: num(m.billingPct) }] : [])]} action={updateMilestone.bind(null, m.id)} />
                      <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={deleteMilestone.bind(null, m.id)} confirm={{ title: "Delete milestone?", confirmLabel: "Delete" }}>Delete</ActionButton>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "boq" && (
        <Card>
          <CardHeader><CardTitle>Bills of quantities</CardTitle>{c.can("boq:view") && <Link href="/sales/boq" className="text-sm font-medium text-brand-700 hover:underline">All BOQs</Link>}</CardHeader>
          {p.boqs.length === 0 ? <EmptyState title="No BOQ for this project" hint="Create one from the BOQ page and link it to this project." /> : (
            <ul className="divide-y divide-slate-100">
              {p.boqs.map((b) => {
                const cost = b.items.reduce((s, i) => s + num(i.estimatedCost), 0);
                const rev = b.items.reduce((s, i) => s + num(i.total), 0);
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1"><Link href={`/sales/boq/${b.id}`} className="font-medium text-slate-900 hover:text-brand-700">{b.number}</Link><p className="text-xs text-slate-500">{b.title} · {b.items.length} items</p></div>
                    <span className="tabular text-sm">{formatINR(rev)}</span>
                    {money && <span className="tabular text-sm text-slate-500">cost {formatINR(cost)}</span>}
                    <StatusBadge status={b.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "materials" && (
        <Card>
          <CardHeader>
            <CardTitle>Material plan vs actual</CardTitle>
            <div className="flex gap-2">
              {c.can("purchase_requests:create") && p.boqs[0] && <Link href={`/procurement/requests/new?boq=${(p.boqs.find((b) => b.status === "APPROVED") ?? p.boqs[0]).id}`}><Button size="sm" variant="secondary">Request material from BOQ</Button></Link>}
              {c.can("inventory:create") && <Link href={`/inventory/issues/new?projectId=${id}`}><Button size="sm">Issue to site</Button></Link>}
            </div>
          </CardHeader>
          {plan.length === 0 ? <EmptyState title="No material activity yet" hint="Link BOQ items to catalogue materials, then raise purchase requests and issue stock to this site." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Material</th><th className="px-3 py-2 text-right">BOQ plan</th><th className="px-3 py-2 text-right">Purchased</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Issued</th><th className="px-3 py-2 text-right">Consumed</th><th className="px-3 py-2 text-right">On site</th><th className="px-3 py-2 text-right">Still to buy</th></tr></thead>
                <tbody>
                  {plan.map((r) => (
                    <tr key={r.materialId} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-medium text-slate-900">{r.name} <span className="text-xs font-normal text-slate-400">{r.unit}</span>{r.overUse && <Badge tone="red" className="ml-2">Over plan</Badge>}</td>
                      <td className="tabular px-3 py-2.5 text-right">{r.planned || "—"}</td><td className="tabular px-3 py-2.5 text-right">{r.purchased || "—"}</td><td className="tabular px-3 py-2.5 text-right">{r.received || "—"}</td>
                      <td className="tabular px-3 py-2.5 text-right">{r.issued || "—"}</td><td className="tabular px-3 py-2.5 text-right">{r.consumed || "—"}</td><td className="tabular px-3 py-2.5 text-right font-medium">{r.onSite}</td>
                      <td className={cn("tabular px-3 py-2.5 text-right", r.toBuy > 0 && "font-medium text-amber-700")}>{r.toBuy || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "documents" && <DocumentsPanel c={c} entityType="PROJECT" entityId={id} />}

      {tab === "financials" && money && fin && <Financials fin={fin} canSync={canEdit} onSync={syncBudgetFromBoq.bind(null, id)} />}
    </>
  );
}

function Timeline({ p, today }: { p: { startDate: Date | null; plannedEndDate: Date | null; tasks: { id: string; name: string; startDate: Date | null; dueDate: Date | null; status: string; progress: number }[]; milestones: { id: string; name: string; dueDate: Date | null; completedAt: Date | null }[] }; today: Date }) {
  const dated = p.tasks.filter((t) => t.dueDate || t.startDate);
  const all = [p.startDate, p.plannedEndDate, ...dated.flatMap((t) => [t.startDate, t.dueDate]), ...p.milestones.map((m) => m.dueDate)].filter(Boolean) as Date[];
  if (all.length < 2) return <Card><EmptyState title="Not enough dates to draw a timeline" hint="Set start/due dates on tasks, or start & planned completion dates on the project." /></Card>;
  const min = Math.min(...all.map((d) => d.getTime()));
  const max = Math.max(...all.map((d) => d.getTime()), today.getTime());
  const span = Math.max(max - min, 86400000);
  const pos = (d: Date) => ((d.getTime() - min) / span) * 100;
  const months: { label: string; left: number }[] = [];
  for (let d = new Date(min); d.getTime() <= max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push({ label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), left: Math.max(0, pos(d)) });
  const color: Record<string, string> = { COMPLETED: "bg-emerald-500", IN_PROGRESS: "bg-brand-600", BLOCKED: "bg-red-500", TODO: "bg-slate-300" };

  return (
    <Card>
      <CardHeader><CardTitle>Timeline</CardTitle><span className="text-xs text-slate-500">Red line = today</span></CardHeader>
      <div className="overflow-x-auto p-5">
        <div className="relative min-w-[700px]">
          <div className="relative mb-2 ml-44 h-5 text-[11px] text-slate-500">{months.map((m) => <span key={m.label + m.left} className="absolute" style={{ left: `${m.left}%` }}>{m.label}</span>)}</div>
          <div className="space-y-2">
            {dated.map((t) => {
              const s = t.startDate ?? t.dueDate!;
              const e = t.dueDate ?? t.startDate!;
              const left = pos(s);
              const width = Math.max(pos(e) - left, 1.2);
              return (
                <div key={t.id} className="flex items-center">
                  <div className="w-44 shrink-0 truncate pr-3 text-xs text-slate-700">{t.name}</div>
                  <div className="relative h-5 flex-1 rounded bg-slate-50">
                    <div className={cn("absolute h-5 rounded", color[t.status] ?? "bg-slate-300")} style={{ left: `${left}%`, width: `${width}%` }} title={`${t.name}: ${t.progress}%`}>
                      <div className="h-full rounded bg-black/15" style={{ width: `${t.progress}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {p.milestones.filter((m) => m.dueDate).map((m) => (
              <div key={m.id} className="flex items-center">
                <div className="w-44 shrink-0 truncate pr-3 text-xs font-medium text-slate-800">◆ {m.name}</div>
                <div className="relative h-5 flex-1 rounded bg-slate-50"><div className={cn("absolute top-0.5 h-4 w-4 rotate-45 rounded-sm", m.completedAt ? "bg-emerald-500" : "bg-amber-500")} style={{ left: `calc(${pos(m.dueDate!)}% - 8px)` }} title={`${m.name} – ${formatDate(m.dueDate)}`} /></div>
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-0 top-6 w-px bg-red-500" style={{ left: `calc(11rem + (100% - 11rem) * ${pos(today) / 100})` }} />
        </div>
      </div>
    </Card>
  );
}

function Financials({ fin, canSync, onSync }: { fin: NonNullable<Awaited<ReturnType<typeof oneProjectFinancials>>>; canSync: boolean; onSync: () => Promise<import("@/lib/action").ActionResult> }) {
  const buckets = [
    { label: "Material", v: fin.material, c: "bg-brand-700" }, { label: "Labour", v: fin.labour, c: "bg-teal-600" },
    { label: "Vendors / sub-contract", v: fin.vendor, c: "bg-amber-500" }, { label: "Other expenses", v: fin.other, c: "bg-slate-400" },
  ];
  const scale = Math.max(fin.budget, fin.actualCost, 1);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Contract value" value={formatINR(fin.contractValue)} />
        <StatCard label="Budget (est. cost)" value={formatINR(fin.budget)} sub={fin.budget > 0 ? `Est. profit ${formatINR(fin.estimatedProfit)}` : "Set from the BOQ"} />
        <StatCard label="Actual cost" value={formatINR(fin.actualCost)} tone={fin.overBudget ? "bad" : "default"} sub={fin.budget > 0 ? `${fin.variance > 0 ? "+" : ""}${formatINR(fin.variance)} vs budget (${fin.variancePct.toFixed(1)}%)` : undefined} />
        <StatCard label="Gross profit" value={formatINR(fin.profit)} tone={fin.marginPct < 15 && fin.actualCost > 0 ? "bad" : "good"} sub={`Margin ${fin.marginPct.toFixed(1)}%`} />
      </div>
      <Card>
        <CardHeader><CardTitle>Where the money went</CardTitle>{canSync && <ActionButton size="sm" variant="secondary" action={onSync}>Set budget from BOQ</ActionButton>}</CardHeader>
        <CardBody className="space-y-4">
          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Actual cost vs budget</p>
            <div className="relative h-6 overflow-hidden rounded bg-slate-100">
              <div className="flex h-full" style={{ width: `${(fin.actualCost / scale) * 100}%` }}>
                {buckets.map((b) => <div key={b.label} className={b.c} style={{ width: `${fin.actualCost ? (b.v / fin.actualCost) * 100 : 0}%` }} title={`${b.label}: ${formatINR(b.v)}`} />)}
              </div>
              {fin.budget > 0 && <div className="absolute inset-y-0 w-0.5 bg-red-600" style={{ left: `${(fin.budget / scale) * 100}%` }} title={`Budget ${formatINR(fin.budget)}`} />}
            </div>
            <p className="mt-1 text-xs text-slate-500">Red marker = budget</p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-2 text-sm"><span className={cn("h-3 w-3 rounded-sm", b.c)} /><dt className="text-slate-600">{b.label}</dt><dd className="tabular ml-auto font-medium">{formatINR(b.v)}</dd></div>
            ))}
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Billing</CardTitle></CardHeader>
        <CardBody>
          <DetailGrid items={[{ label: "Billed (excl. GST)", value: formatINR(fin.billed) }, { label: "Collected", value: formatINR(fin.collected) }, { label: "Outstanding (incl. GST)", value: <span className={fin.outstanding > 0 ? "font-medium text-amber-700" : ""}>{formatINR(fin.outstanding)}</span> }]} />
        </CardBody>
      </Card>
    </div>
  );
}
