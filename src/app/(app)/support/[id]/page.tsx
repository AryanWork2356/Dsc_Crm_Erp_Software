import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { userOptions } from "@/lib/lookups";
import { PRIORITY_OPTS } from "@/lib/enums";
import { warrantyUntil } from "@/lib/warranty";
import { formatDate, humanize } from "@/lib/utils";
import { PageHeader, DetailGrid, EmptyState, Alert } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { addWarrantyClaim, decideWarrantyClaim, setTicketStatus, toggleWarranty, updateTicket } from "../actions";

const NEXT: Record<string, { to: string; label: string; needsNote?: boolean }[]> = {
  OPEN: [{ to: "IN_PROGRESS", label: "Start work" }, { to: "WAITING", label: "Waiting on client" }, { to: "RESOLVED", label: "Resolve", needsNote: true }],
  ASSIGNED: [{ to: "IN_PROGRESS", label: "Start work" }, { to: "WAITING", label: "Waiting on client" }, { to: "RESOLVED", label: "Resolve", needsNote: true }],
  IN_PROGRESS: [{ to: "WAITING", label: "Waiting on client" }, { to: "RESOLVED", label: "Resolve", needsNote: true }],
  WAITING: [{ to: "IN_PROGRESS", label: "Resume" }, { to: "RESOLVED", label: "Resolve", needsNote: true }],
  RESOLVED: [{ to: "CLOSED", label: "Close ticket" }, { to: "IN_PROGRESS", label: "Reopen" }],
  CLOSED: [{ to: "IN_PROGRESS", label: "Reopen" }],
};

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("support:view");
  const t = await db.supportTicket.findFirst({ where: { id, companyId: c.companyId }, include: { client: true, project: true, claims: { orderBy: { createdAt: "asc" } } } });
  if (!t) notFound();
  if (!["OWNER", "MANAGEMENT", "ADMIN", "SALES"].includes(c.role)) {
    const ok = t.assignedToId === c.userId || (t.project && [t.project.projectManagerId, t.project.siteEngineerId, t.project.supervisorId].includes(c.userId));
    if (!ok) redirect("/forbidden");
  }
  const staff = await userOptions(c.companyId);
  const assignee = staff.find((s) => s.value === t.assignedToId)?.label;
  const until = t.project ? warrantyUntil(t.project) : null;
  const edit = c.can("support:edit");

  return (
    <>
      <PageHeader
        back={{ href: "/support", label: "All tickets" }} title={t.subject} subtitle={`${t.number} · opened ${formatDate(t.createdAt)}`}
        actions={<>
          <StatusBadge status={t.status} /><StatusBadge status={t.priority} />
          {edit && (NEXT[t.status] ?? []).map((n) => n.needsNote ? (
            <FormDialog key={n.to} title="Resolve this ticket" trigger={<Button size="sm" variant="success">{n.label}</Button>} fields={[{ name: "resolution", label: "How was it resolved?", type: "textarea", required: true, defaultValue: t.resolution }]} action={setTicketStatus.bind(null, id, n.to)} submitLabel="Resolve" />
          ) : (
            <ActionButton key={n.to} size="sm" variant="secondary" action={setTicketStatus.bind(null, id, n.to)}>{n.label}</ActionButton>
          ))}
          {edit && <FormDialog title="Edit ticket" wide trigger={<Button size="sm" variant="ghost">Edit</Button>} fields={[{ name: "subject", label: "Issue", required: true, full: true, defaultValue: t.subject }, { name: "priority", label: "Priority", type: "select", options: PRIORITY_OPTS, defaultValue: t.priority }, { name: "assignedToId", label: "Assigned to", type: "select", options: staff, defaultValue: t.assignedToId }, { name: "description", label: "Details", type: "textarea", defaultValue: t.description }]} action={updateTicket.bind(null, id)} />}
        </>}
      />
      {t.isWarranty ? <div className="mb-4"><Alert tone="good">Under warranty{until ? ` until ${formatDate(until)}` : ""}. Repairs are free of charge.</Alert></div> : t.project && <div className="mb-4"><Alert tone="warn">Outside the warranty period{until ? ` (ended ${formatDate(until)})` : ""} – this may be chargeable.</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardBody>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{t.description || "No description."}</p>
            {t.resolution && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Resolution</p><p className="mt-1 whitespace-pre-wrap text-emerald-900">{t.resolution}</p></div>}
          </CardBody></Card>
          <Card>
            <CardHeader><CardTitle>Warranty claims ({t.claims.length})</CardTitle>{edit && t.isWarranty && <FormDialog title="Add warranty claim" trigger={<Button size="sm" variant="secondary">Add claim</Button>} fields={[{ name: "item", label: "What is claimed?", required: true, full: true, placeholder: "e.g. Wardrobe shutter hinge replacement" }, { name: "notes", label: "Notes", type: "textarea" }]} action={addWarrantyClaim.bind(null, id)} />}</CardHeader>
            {t.claims.length === 0 ? <EmptyState title="No claims" hint={t.isWarranty ? undefined : "Claims can only be raised on warranty tickets."} /> : (
              <ul className="divide-y divide-slate-100">
                {t.claims.map((cl) => (
                  <li key={cl.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{cl.item}</p>{cl.notes && <p className="whitespace-pre-wrap text-xs text-slate-500">{cl.notes}</p>}</div>
                    {cl.approved === null ? (c.can("support:approve") ? <>
                      <ActionButton size="sm" variant="success" action={decideWarrantyClaim.bind(null, cl.id, true, undefined)}>Approve</ActionButton>
                      <FormDialog title="Decline claim" trigger={<Button size="sm" variant="secondary">Decline</Button>} fields={[{ name: "notes", label: "Reason", type: "textarea", required: true }]} action={decideWarrantyClaim.bind(null, cl.id, false)} submitLabel="Decline" />
                    </> : <Badge tone="amber">Pending</Badge>) : cl.approved ? <Badge tone="green">Approved</Badge> : <Badge tone="red">Declined</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {c.can("documents:view") && <DocumentsPanel c={c} entityType="TICKET" entityId={id} title="Photos & files" />}
        </div>
        <div className="space-y-5">
          <Card><CardHeader><CardTitle>Summary</CardTitle></CardHeader><CardBody>
            <DetailGrid items={[{ label: "Client", value: <Link className="text-brand-700 hover:underline" href={`/crm/clients/${t.clientId}`}>{t.client.name}</Link> }, { label: "Project", value: t.project ? <Link className="text-brand-700 hover:underline" href={`/projects/${t.project.id}`}>{t.project.code} · {t.project.name}</Link> : null }, { label: "Assigned to", value: assignee ?? "Unassigned" }, { label: "Phone", value: t.client.phone }, { label: "Status", value: humanize(t.status) }]} />
            {c.can("support:approve") && <div className="mt-4 border-t border-slate-100 pt-3"><ActionButton size="sm" variant="ghost" action={toggleWarranty.bind(null, id)}>{t.isWarranty ? "Mark as chargeable" : "Mark as under warranty"}</ActionButton></div>}
          </CardBody></Card>
        </div>
      </div>
    </>
  );
}
