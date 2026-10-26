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
import { approveExtraWorkInternally, completeExtraWork, createExtraWork, linkExtraWorkInvoice, recordClientDecision, sendExtraWork, startExtraWork, verifyExtraWork } from "./actions";

export const metadata = { title: "Extra work" };

const TONE = { DRAFT: "slate", SENT: "blue", APPROVED: "green", REJECTED: "red", IN_PROGRESS: "teal", COMPLETED: "green" } as const;
const KIND_LABEL = { CHARGEABLE: "Chargeable", INCLUDED: "Included in the contract", EMERGENCY: "Emergency", OWN_REWORK: "DSC's own rework", CONCESSION: "Given free (concession)" } as const;
const KIND_OPTS = [
  { value: "CHARGEABLE", label: "Chargeable: outside the contract, the client pays" },
  { value: "INCLUDED", label: "Included: already in the contract (no charge)" },
  { value: "EMERGENCY", label: "Emergency: cannot wait, client approves after" },
  { value: "OWN_REWORK", label: "Rework: putting right DSC's own mistake (no charge)" },
  { value: "CONCESSION", label: "Concession: DSC chooses to give it free" },
];
const BILLABLE = ["CHARGEABLE", "EMERGENCY"];
const LABEL = { DRAFT: "Draft", SENT: "Waiting for client", APPROVED: "Client approved", REJECTED: "Client declined", IN_PROGRESS: "In progress", COMPLETED: "Completed" } as const;

export default async function ExtraWorkPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("extra_work:view");
  const sp = flatten(await searchParams);
  const tab = sp.tab === "all" ? "all" : "open";
  const scope = projectScope(c);
  const projects = await db.project.findMany({ where: { ...scope, status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const rows = await db.additionalWork.findMany({
    where: { companyId: c.companyId, project: scope, ...(tab === "open" ? { OR: [{ status: { in: ["DRAFT", "SENT", "APPROVED", "REJECTED", "IN_PROGRESS"] } }, { status: "COMPLETED", OR: [{ verifiedAt: null }, { kind: { in: ["CHARGEABLE", "EMERGENCY"] }, billedInvoiceId: null }] }] } : {}) },
    include: { project: { select: { id: true, code: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 80,
  });
  const people = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requestedById))] } }, select: { id: true, name: true } });
  const who = new Map(people.map((u) => [u.id, u.name]));
  const canEdit = c.can("extra_work:edit");
  const canApprove = c.can("extra_work:approve");
  const canBill = c.can("invoices:create");
  const canCosts = c.can("margins:view");
  const invoices = canBill ? await db.invoice.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { not: "CANCELLED" }, projectId: { in: [...new Set(rows.map((r) => r.projectId))] } }, select: { id: true, number: true, projectId: true }, orderBy: { createdAt: "desc" }, take: 300 }) : [];

  return (
    <div>
      <PageHeader
        title="Extra work"
        subtitle="Work outside the agreed scope. It cannot start until the client has approved it in writing."
        actions={c.can("extra_work:create") && projects.length > 0 ? (
          <FormDialog title="Raise extra work" description="Describe the work and its cost. The project manager sends it to the client for approval." wide trigger={<Button>New extra work</Button>}
            fields={[
              { name: "projectId", label: "Project", type: "select", required: true, options: projects.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` })) },
              { name: "kind", label: "What kind of work is it?", type: "select", required: true, options: KIND_OPTS, defaultValue: "CHARGEABLE", full: true },
              { name: "title", label: "What is the extra work?", required: true },
              { name: "inOriginalScope", label: "Is it already in the contract?", type: "select", options: [{ value: "NO", label: "No, it is outside the contract" }, { value: "YES", label: "Yes, it is already in the contract" }], defaultValue: "NO", hint: "Check the BOQ and drawings first" },
              { name: "description", label: "Details", type: "textarea", full: true },
              { name: "amount", label: "Price to the client (₹, excl. GST)", type: "number", defaultValue: 0, hint: "0 for included work and DSC's own rework; for a concession, the value given free" },
              { name: "costEstimate", label: "DSC's own extra cost (₹)", type: "number", defaultValue: 0 },
              { name: "scheduleImpactDays", label: "Days it adds to the schedule", type: "number", defaultValue: 0 },
              { name: "scopeNote", label: "Scope check, or the reason", type: "textarea", full: true, hint: "Required for emergency work, concessions and rework: what happened and why" },
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
                <div className="flex items-center gap-2"><span className="tabular text-sm font-semibold">{formatINR(w.amount)}</span>{w.kind !== "CHARGEABLE" && <Badge tone={w.kind === "EMERGENCY" ? "red" : "slate"}>{KIND_LABEL[w.kind]}</Badge>}<Badge tone={TONE[w.status]}>{LABEL[w.status]}</Badge></div>
              </div>
              {w.description && <p className="mt-2 text-sm text-slate-700">{w.description}</p>}
              {(w.scopeNote || w.scheduleImpactDays !== 0 || (canCosts && Number(w.costEstimate) > 0)) && (
                <p className="mt-1 text-xs text-slate-500">
                  {w.scopeNote && <>Scope: {w.scopeNote}. </>}{w.scheduleImpactDays !== 0 && <>Schedule: {w.scheduleImpactDays > 0 ? "+" : ""}{w.scheduleImpactDays} day(s). </>}
                  {canCosts && Number(w.costEstimate) > 0 && <>Our cost {formatINR(w.costEstimate)}{BILLABLE.includes(w.kind) && Number(w.amount) > 0 ? ` · margin ${Math.round(((Number(w.amount) - Number(w.costEstimate)) / Number(w.amount)) * 100)}%` : ""}. </>}
                </p>
              )}
              {w.internalApprovedAt && <p className="mt-1 text-xs text-emerald-700">Director approved {formatDateTime(w.internalApprovedAt)}: {w.internalNote}</p>}
              {w.status === "COMPLETED" && w.verifiedAt && <p className="mt-1 text-xs text-emerald-700">Verified {formatDateTime(w.verifiedAt)}: {w.verifyNote}</p>}
              {w.status === "COMPLETED" && BILLABLE.includes(w.kind) && !w.billedInvoiceId && <div className="mt-2"><Alert tone="warn">Completed but not on an invoice yet.</Alert></div>}
              {w.kind === "EMERGENCY" && !w.decidedAt && ["IN_PROGRESS", "COMPLETED"].includes(w.status) && <div className="mt-2"><Alert tone="bad">Emergency work started without the client&apos;s written approval. Record it as soon as it arrives.</Alert></div>}
              {w.decidedAt && <p className="mt-2 text-xs text-slate-500">{w.status === "REJECTED" ? "Declined" : "Approved"} by {w.decidedByName ?? "client"} {w.decisionVia === "PORTAL" ? "in the portal" : "(written proof recorded)"} on {formatDateTime(w.decidedAt)}{w.decisionNote ? ` · “${w.decisionNote}”` : ""}{w.approvalDocId && <> · <a className="text-brand-700 hover:underline" href={`/documents/${w.approvalDocId}/download`}>view proof</a></>}</p>}
              {w.kind === "CHARGEABLE" && (w.status === "DRAFT" || w.status === "SENT" || w.status === "REJECTED") && <div className="mt-3"><Alert tone="warn">Work on this cannot start until the client approves.</Alert></div>}
              {(w.kind === "EMERGENCY" || w.kind === "CONCESSION") && !w.internalApprovedAt && w.status === "DRAFT" && <div className="mt-3"><Alert tone="warn">A director must approve this before it can start.</Alert></div>}
              {canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {BILLABLE.includes(w.kind) && (w.status === "DRAFT" || w.status === "REJECTED") && <ActionButton action={sendExtraWork.bind(null, w.id)} confirm={{ title: "Send to the client?", body: "They get a notification and can approve in their portal.", confirmLabel: "Send" }}>Send to client</ActionButton>}
                  {BILLABLE.includes(w.kind) && (w.status === "DRAFT" || w.status === "SENT" || (w.kind === "EMERGENCY" && ["IN_PROGRESS", "COMPLETED"].includes(w.status) && !w.decidedAt)) && (
                    <>
                      <FormDialog title={`Record client approval – ${w.number}`} description="Upload the client's written approval: signed letter, e-mail or message screenshot." trigger={<Button variant="secondary">Record client approval</Button>}
                        fields={[{ name: "decidedByName", label: "Approved by (name at client)", required: true }, { name: "proof", label: "Written approval (photo / PDF)", type: "file", required: true, full: true }, { name: "note", label: "Note", type: "textarea", full: true }]}
                        action={recordClientDecision.bind(null, w.id, true)} submitLabel="Record approval" />
                      <FormDialog title={`Client declined – ${w.number}`} trigger={<Button variant="ghost">Client declined</Button>}
                        fields={[{ name: "decidedByName", label: "Declined by (name at client)", required: true }, { name: "note", label: "Reason given", type: "textarea", required: true, full: true }]}
                        action={recordClientDecision.bind(null, w.id, false)} submitLabel="Record" />
                    </>
                  )}
                  {(w.kind === "EMERGENCY" || w.kind === "CONCESSION") && !w.internalApprovedAt && w.status === "DRAFT" && canApprove && (
                    <FormDialog title={`Director approval – ${w.number}`} description="Say why you are approving this. It is recorded against your name." trigger={<Button variant="secondary">Approve (director)</Button>} fields={[{ name: "note", label: "Reason", type: "textarea", required: true, full: true }]} action={approveExtraWorkInternally.bind(null, w.id)} submitLabel="Approve" />
                  )}
                  {((w.kind === "CHARGEABLE" && w.status === "APPROVED") || (w.kind !== "CHARGEABLE" && ["DRAFT", "APPROVED"].includes(w.status) && (w.kind === "INCLUDED" || w.kind === "OWN_REWORK" || w.internalApprovedAt))) && <ActionButton action={startExtraWork.bind(null, w.id)}>Start work</ActionButton>}
                  {w.status === "COMPLETED" && !w.verifiedAt && <FormDialog title={`Verify ${w.number}`} description="Check and measure the finished work." trigger={<Button variant="secondary">Verify the work</Button>} fields={[{ name: "note", label: "What did you measure or check?", type: "textarea", required: true, full: true }]} action={verifyExtraWork.bind(null, w.id)} submitLabel="Verified" />}
                  {w.status === "IN_PROGRESS" && <ActionButton variant="success" action={completeExtraWork.bind(null, w.id)} confirm={{ title: "Mark as completed?", body: "Accounts is told to bill it.", confirmLabel: "Completed" }}>Mark completed</ActionButton>}
                </div>
              )}
              {canBill && BILLABLE.includes(w.kind) && w.status === "COMPLETED" && !w.billedInvoiceId && (
                <div className="mt-3">
                  <FormDialog title={`Link ${w.number} to its invoice`} description="Choose the invoice this work was billed on." trigger={<Button variant="secondary">Link to invoice</Button>} fields={[{ name: "invoiceId", label: "Invoice", type: "select", required: true, options: invoices.filter((i) => i.projectId === w.projectId).map((i) => ({ value: i.id, label: i.number })) }]} action={linkExtraWorkInvoice.bind(null, w.id)} submitLabel="Link" />
                </div>
              )}
              {w.billedInvoiceId && <p className="mt-2 text-xs text-emerald-700">Billed on invoice {invoices.find((i) => i.id === w.billedInvoiceId)?.number ?? "(linked)"}.</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
