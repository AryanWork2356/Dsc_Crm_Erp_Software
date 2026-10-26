import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { userOptions } from "@/lib/lookups";
import { cn, formatDate, startOfDay, toDateInput } from "@/lib/utils";
import { PageHeader, StatCard, EmptyState } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { cancelActionItem, createActionItem, reassignActionItem, resolveActionItem, startActionItem } from "./actions";

export const metadata = { title: "Actions and blockers" };

const SEVERITY = [
  { value: "CRITICAL", label: "Critical – stops work today" },
  { value: "HIGH", label: "High – fix tomorrow" },
  { value: "MEDIUM", label: "Medium – within 3 days" },
  { value: "LOW", label: "Low – within a week" },
];
const TONE = { CRITICAL: "red", HIGH: "amber", MEDIUM: "blue", LOW: "slate" } as const;

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const c = await requirePerm("actions:view");
  const { view = "mine" } = await searchParams;
  const today = startOfDay(new Date());
  const wide = ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role);

  // people see their own and what they raised, plus everything on projects they work on; directors see all
  const projects = await db.project.findMany({ where: wide ? { companyId: c.companyId, deletedAt: null } : projectScope(c), select: { id: true, code: true, name: true }, orderBy: { createdAt: "desc" }, take: 500 });
  const visible: Prisma.ActionItemWhereInput = wide ? { companyId: c.companyId } : { companyId: c.companyId, OR: [{ ownerId: c.userId }, { createdById: c.userId }, { projectId: { in: projects.map((p) => p.id) } }] };
  const open = { status: { in: ["OPEN", "IN_PROGRESS"] as ("OPEN" | "IN_PROGRESS")[] } };
  const where: Prisma.ActionItemWhereInput = view === "done" ? { AND: [visible, { status: { in: ["RESOLVED", "CANCELLED"] } }] } : view === "open" ? { AND: [visible, open] } : { AND: [visible, open, { ownerId: c.userId }] };

  const [rows, mine, overdue, urgent, team] = await Promise.all([
    db.actionItem.findMany({ where, orderBy: view === "done" ? { resolvedAt: "desc" } : [{ dueDate: "asc" }], take: 200 }),
    db.actionItem.count({ where: { AND: [visible, open, { ownerId: c.userId }] } }),
    db.actionItem.count({ where: { AND: [visible, open, { dueDate: { lt: today } }] } }),
    db.actionItem.count({ where: { AND: [visible, open, { severity: { in: ["HIGH", "CRITICAL"] } }] } }),
    userOptions(c.companyId),
  ]);
  const names = new Map(team.map((t) => [t.value, t.label]));
  const pcode = new Map(projects.map((p) => [p.id, `${p.code} · ${p.name}`]));
  const canCreate = c.can("actions:create");
  const canEdit = c.can("actions:edit");
  const pill = (v: string, label: string) => <Link key={v} href={`/actions?view=${v}`} className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium", view === v ? "border-brand-800 bg-brand-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>{label}</Link>;

  return (
    <>
      <PageHeader
        title="Actions and blockers"
        subtitle="Every problem or job that needs doing has one owner and a date. When it is late, the owner, then the project manager, then the directors are told."
        actions={canCreate && (
          <FormDialog
            title="New action"
            trigger={<Button>New action</Button>}
            fields={[
              { name: "title", label: "What has to be done or fixed?", required: true, full: true, placeholder: "e.g. Only 4 of 8 carpenters came to Retail B" },
              { name: "detail", label: "Details", type: "textarea", full: true },
              { name: "severity", label: "How serious?", type: "select", options: SEVERITY, defaultValue: "MEDIUM" },
              { name: "ownerId", label: "Who will do it?", type: "select", options: team, defaultValue: c.userId },
              { name: "projectId", label: "Project (if any)", type: "select", options: projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) },
              { name: "dueDate", label: "Due date", type: "date", hint: "Left empty, it is set from how serious it is" },
            ]}
            action={createActionItem}
            successMessage="Action added"
          />
        )}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Mine, still open" value={mine} href="/actions?view=mine" />
        <StatCard label="Late (all open)" value={overdue} tone={overdue ? "bad" : "default"} href="/actions?view=open" />
        <StatCard label="High or critical, open" value={urgent} tone={urgent ? "warn" : "default"} href="/actions?view=open" />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">{pill("mine", "Mine")}{pill("open", "All open")}{pill("done", "Closed")}</div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={view === "done" ? "Nothing closed yet" : "No open actions"} hint="Use New action to record a blocker, a shortage or a job that needs an owner and a date." />
        ) : (
          <Table>
            <THead><tr><Th>Action</Th><Th>Severity</Th><Th>Project</Th><Th>Owner</Th><Th>Due</Th><Th>Status</Th><Th /></tr></THead>
            <tbody>
              {rows.map((a) => {
                const late = ["OPEN", "IN_PROGRESS"].includes(a.status) && a.dueDate < today;
                const closed = !["OPEN", "IN_PROGRESS"].includes(a.status);
                return (
                  <Tr key={a.id}>
                    <Td className="max-w-md">
                      <p className="font-medium text-slate-900">{a.link ? <Link href={a.link} className="hover:text-brand-700">{a.title}</Link> : a.title}</p>
                      <p className="text-xs text-slate-500">{a.number}{a.sourceLabel ? ` · from ${a.sourceLabel}` : ""}{a.detail ? ` · ${a.detail}` : ""}</p>
                      {closed && a.resolution && <p className="mt-0.5 text-xs text-emerald-700">Done: {a.resolution}</p>}
                    </Td>
                    <Td><Badge tone={TONE[a.severity]}>{a.severity.charAt(0) + a.severity.slice(1).toLowerCase()}</Badge></Td>
                    <Td className="text-xs">{a.projectId ? pcode.get(a.projectId) ?? "—" : "—"}</Td>
                    <Td className="text-sm">{names.get(a.ownerId) ?? "—"}</Td>
                    <Td className={cn("whitespace-nowrap text-sm", late && "font-medium text-red-600")}>{formatDate(a.dueDate)}{late && " (late)"}</Td>
                    <Td><Badge tone={a.status === "RESOLVED" ? "green" : a.status === "CANCELLED" ? "slate" : a.status === "IN_PROGRESS" ? "teal" : "blue"}>{a.status === "IN_PROGRESS" ? "In progress" : a.status.charAt(0) + a.status.slice(1).toLowerCase()}</Badge></Td>
                    <Td className="text-right">
                      {canEdit && !closed && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {a.status === "OPEN" && <ActionButton size="sm" variant="secondary" action={startActionItem.bind(null, a.id)}>Start</ActionButton>}
                          <FormDialog title={`Finish ${a.number}`} description="Write what was done. This is the proof it is finished." trigger={<Button size="sm">Done</Button>} fields={[{ name: "resolution", label: "What was done?", type: "textarea", required: true, full: true }]} action={resolveActionItem.bind(null, a.id)} submitLabel="Mark as done" />
                          <FormDialog title={`Change owner or date – ${a.number}`} trigger={<Button size="sm" variant="ghost">Change</Button>} fields={[{ name: "ownerId", label: "Owner", type: "select", options: team, required: true, defaultValue: a.ownerId }, { name: "dueDate", label: "Due date", type: "date", required: true, defaultValue: toDateInput(a.dueDate) }, { name: "reason", label: "Why?", type: "textarea", required: true, full: true }]} action={reassignActionItem.bind(null, a.id)} />
                          <FormDialog title={`Cancel ${a.number}`} trigger={<Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50">Cancel</Button>} fields={[{ name: "reason", label: "Why is it not needed?", type: "textarea", required: true, full: true }]} action={cancelActionItem.bind(null, a.id)} submitLabel="Cancel action" />
                        </div>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
