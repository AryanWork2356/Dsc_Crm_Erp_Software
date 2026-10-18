import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten } from "@/lib/list";
import { formatDateTime, formatINR } from "@/lib/utils";
import { PageHeader, EmptyState, TabLinks, Alert } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/forms/action-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { completeExtraWork, createExtraWork, recordClientDecision, sendExtraWork, startExtraWork } from "./actions";

export const metadata = { title: "Extra work" };

const TONE = { DRAFT: "slate", SENT: "blue", APPROVED: "green", REJECTED: "red", IN_PROGRESS: "teal", COMPLETED: "green" } as const;
const LABEL = { DRAFT: "Draft", SENT: "Waiting for client", APPROVED: "Client approved", REJECTED: "Client declined", IN_PROGRESS: "In progress", COMPLETED: "Completed" } as const;

export default async function ExtraWorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("extra_work:view");
  const sp = flatten(await searchParams);
  const tab = sp.tab === "all" ? "all" : "open";
  const scope = projectScope(c);
  const projects = await db.project.findMany({ where: { ...scope, status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const rows = await db.additionalWork.findMany({
    where: { companyId: c.companyId, project: scope, ...(tab === "open" ? { status: { in: ["DRAFT", "SENT", "APPROVED", "REJECTED", "IN_PROGRESS"] } } : {}) },
    include: { project: { select: { id: true, code: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 80,
  });
  const people = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requestedById))] } }, select: { id: true, name: true } });
  const who = new Map(people.map((u) => [u.id, u.name]));
  const canEdit = c.can("extra_work:edit");

  return (
    <div>
      <PageHeader
        title="Extra work"
        subtitle="Work outside the agreed scope. It cannot start until the client has approved it in writing."
        actions={c.can("extra_work:create") && projects.length > 0 ? (
          <FormDialog title="Raise extra work" description="Describe the work and its cost. The project manager sends it to the client for approval." wide trigger={<Button>New extra work</Button>}
            fields={[
              { name: "projectId", label: "Project", type: "select", required: true, options: projects.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` })) },
              { name: "title", label: "What is the extra work?", required: true },
              { name: "description", label: "Details", type: "textarea", full: true },
              { name: "amount", label: "Cost to the client (₹, excl. GST)", type: "number", defaultValue: 0, hint: "The project manager can fill this in later" },
            ]} action={createExtraWork} submitLabel="Save as draft" />
        ) : undefined}
      />
      <div className="mb-4"><TabLinks current={tab} tabs={[{ key: "open", label: "Open", href: "/extra-work" }, { key: "all", label: "All", href: "/extra-work?tab=all" }]} /></div>
      {rows.length === 0 ? <EmptyState title="No extra work" hint="When the client asks for something outside the agreed scope, raise it here before anyone starts." /> : (
        <div className="space-y-3">
          {rows.map((w) => (
            <Card key={w.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{w.number} · {w.title}</p>
                  <p className="text-xs text-slate-500">{w.project.code} – {w.project.name} · raised by {who.get(w.requestedById) ?? "—"} on {formatDateTime(w.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2"><span className="tabular text-sm font-semibold">{formatINR(w.amount)}</span><Badge tone={TONE[w.status]}>{LABEL[w.status]}</Badge></div>
              </div>
              {w.description && <p className="mt-2 text-sm text-slate-700">{w.description}</p>}
              {w.decidedAt && <p className="mt-2 text-xs text-slate-500">{w.status === "REJECTED" ? "Declined" : "Approved"} by {w.decidedByName ?? "client"} {w.decisionVia === "PORTAL" ? "in the portal" : "(written proof recorded)"} on {formatDateTime(w.decidedAt)}{w.decisionNote ? ` · “${w.decisionNote}”` : ""}{w.approvalDocId && <> · <a className="text-brand-700 hover:underline" href={`/documents/${w.approvalDocId}/download`}>view proof</a></>}</p>}
              {(w.status === "DRAFT" || w.status === "SENT" || w.status === "REJECTED") && <div className="mt-3"><Alert tone="warn">Work on this cannot start until the client approves.</Alert></div>}
              {canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(w.status === "DRAFT" || w.status === "REJECTED") && <ActionButton action={sendExtraWork.bind(null, w.id)} confirm={{ title: "Send to the client?", body: "They get a notification and can approve in their portal.", confirmLabel: "Send" }}>Send to client</ActionButton>}
                  {(w.status === "DRAFT" || w.status === "SENT") && (
                    <>
                      <FormDialog title={`Record client approval – ${w.number}`} description="Upload the client's written approval: signed letter, e-mail or message screenshot." trigger={<Button variant="secondary">Record client approval</Button>}
                        fields={[{ name: "decidedByName", label: "Approved by (name at client)", required: true }, { name: "proof", label: "Written approval (photo / PDF)", type: "file", required: true, full: true }, { name: "note", label: "Note", type: "textarea", full: true }]}
                        action={recordClientDecision.bind(null, w.id, true)} submitLabel="Record approval" />
                      <FormDialog title={`Client declined – ${w.number}`} trigger={<Button variant="ghost">Client declined</Button>}
                        fields={[{ name: "decidedByName", label: "Declined by (name at client)", required: true }, { name: "note", label: "Reason given", type: "textarea", required: true, full: true }]}
                        action={recordClientDecision.bind(null, w.id, false)} submitLabel="Record" />
                    </>
                  )}
                  {w.status === "APPROVED" && <ActionButton action={startExtraWork.bind(null, w.id)}>Start work</ActionButton>}
                  {w.status === "IN_PROGRESS" && <ActionButton variant="success" action={completeExtraWork.bind(null, w.id)} confirm={{ title: "Mark as completed?", body: "Accounts is told to bill it.", confirmLabel: "Completed" }}>Mark completed</ActionButton>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
