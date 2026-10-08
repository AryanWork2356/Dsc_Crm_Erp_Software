import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Phone, MessageCircle, Mail, StickyNote, RefreshCw, CalendarClock } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/scope";
import { LEAD_STAGE_OPTS } from "@/lib/enums";
import { SALES_ROLES, userOptions } from "@/lib/lookups";
import { formatDate, formatDateTime, formatINR, humanize, startOfDay, cn } from "@/lib/utils";
import { PageHeader, DetailGrid, EmptyState } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { addLeadActivity, changeLeadStage, convertLeadToClient, deleteLead, setFollowUp, updateLead, completeFollowUp, createSiteVisit } from "../../actions";
import { leadFields } from "../lead-fields";
import { StageSelect } from "./stage-select";
import { siteVisitFields } from "../../site-visits/visit-fields";
import { DocumentsPanel } from "@/components/documents/documents-panel";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  CALL: Phone, WHATSAPP: MessageCircle, EMAIL: Mail, NOTE: StickyNote, STAGE_CHANGE: RefreshCw, FOLLOW_UP: CalendarClock,
};

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("leads:view");
  const lead = await db.lead.findFirst({
    where: { id, ...leadScope(c) },
    include: { activities: { orderBy: { createdAt: "desc" }, take: 100 }, siteVisits: { orderBy: { visitDate: "desc" } }, client: true },
  });
  if (!lead) notFound();

  const [users, salesUsers, creators] = await Promise.all([
    userOptions(c.companyId),
    userOptions(c.companyId, SALES_ROLES),
    db.user.findMany({ where: { companyId: c.companyId, id: { in: [...new Set(lead.activities.map((a) => a.userId).filter(Boolean) as string[])] } }, select: { id: true, name: true } }),
  ]);
  const who = new Map(creators.map((u) => [u.id, u.name]));
  const owner = salesUsers.find((u) => u.value === lead.assignedToId)?.label;
  const canEdit = c.can("leads:edit");
  const overdue = lead.nextFollowUp && lead.nextFollowUp < startOfDay() && !["WON", "LOST"].includes(lead.stage);
  const terminal = lead.stage === "WON" || lead.stage === "LOST";

  return (
    <>
      <PageHeader
        back={{ href: "/crm/leads", label: "All leads" }}
        title={lead.name}
        subtitle={<>{lead.code}{lead.companyName ? ` · ${lead.companyName}` : ""} · created {formatDate(lead.createdAt)}</>}
        actions={
          <>
            {canEdit && (
              <StageSelect
                current={lead.stage}
                options={LEAD_STAGE_OPTS}
                action={async (stage, reason) => {
                  "use server";
                  return changeLeadStage(id, stage, reason);
                }}
              />
            )}
            {canEdit && (
              <FormDialog title="Edit lead" wide trigger={<Button variant="secondary">Edit</Button>} fields={leadFields(salesUsers, lead as unknown as Record<string, unknown>, c.role !== "SALES")} action={updateLead.bind(null, id)} />
            )}
          </>
        }
      />

      {lead.stage === "LOST" && lead.lostReason && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Lost: {lead.lostReason}</div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle><StatusBadge status={lead.stage} /></CardHeader>
            <CardBody>
              <DetailGrid
                items={[
                  { label: "Phone", value: lead.phone ? <a className="text-brand-700 hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a> : null },
                  { label: "WhatsApp", value: lead.whatsapp },
                  { label: "Email", value: lead.email },
                  { label: "Source", value: lead.source },
                  { label: "Segment", value: humanize(lead.segment) },
                  { label: "Project type", value: lead.projectType },
                  { label: "Location", value: lead.location },
                  { label: "Estimated value", value: lead.estimatedValue ? formatINR(lead.estimatedValue) : null },
                  { label: "Priority", value: <StatusBadge status={lead.priority} /> },
                  { label: "Owner", value: owner ?? "Unassigned" },
                ]}
              />
              {lead.requirement && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Requirement</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{lead.requirement}</p>
                </div>
              )}
              {lead.notes && (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Internal notes</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{lead.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              {canEdit && (
                <FormDialog
                  title="Log activity"
                  trigger={<Button size="sm">Log call / note</Button>}
                  fields={[
                    { name: "kind", label: "Type", type: "select", required: true, defaultValue: "CALL", options: [{ value: "CALL", label: "Phone call" }, { value: "WHATSAPP", label: "WhatsApp" }, { value: "EMAIL", label: "Email" }, { value: "NOTE", label: "Note" }] },
                    { name: "body", label: "What happened?", type: "textarea", required: true },
                  ]}
                  action={addLeadActivity.bind(null, id)}
                  successMessage="Logged"
                />
              )}
            </CardHeader>
            {lead.activities.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {lead.activities.map((a) => {
                  const Icon = ICON[a.kind] ?? StickyNote;
                  return (
                    <li key={a.id} className="flex gap-3 px-5 py-3.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Icon className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0">
                        <p className="whitespace-pre-wrap text-sm text-slate-800">{a.body}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{a.userId ? who.get(a.userId) ?? "User" : "System"} · {formatDateTime(a.createdAt)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Next follow-up</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              {lead.nextFollowUp ? (
                <p className={cn("text-lg font-semibold", overdue ? "text-red-600" : "text-slate-900")}>
                  {formatDate(lead.nextFollowUp)} {overdue && <Badge tone="red">Overdue</Badge>}
                </p>
              ) : (
                <p className="text-sm text-slate-500">Nothing scheduled.</p>
              )}
              {canEdit && !terminal && (
                <div className="flex flex-wrap gap-2">
                  <FormDialog
                    title="Schedule follow-up"
                    trigger={<Button size="sm" variant="secondary">{lead.nextFollowUp ? "Reschedule" : "Schedule"}</Button>}
                    fields={[{ name: "nextFollowUp", label: "Date", type: "date", required: true }, { name: "note", label: "What to discuss", type: "textarea" }]}
                    action={setFollowUp.bind(null, id)}
                  />
                  {lead.nextFollowUp && (
                    <FormDialog
                      title="Complete follow-up"
                      trigger={<Button size="sm">Mark done</Button>}
                      fields={[{ name: "note", label: "Outcome", type: "textarea" }, { name: "nextFollowUp", label: "Next follow-up (optional)", type: "date" }]}
                      action={completeFollowUp.bind(null, id)}
                    />
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Site visits</CardTitle>
              {c.can("sitevisits:create") && (
                <FormDialog
                  title="Schedule site visit"
                  wide
                  trigger={<Button size="sm" variant="secondary">Schedule</Button>}
                  fields={siteVisitFields({ users, lead: { id: lead.id, label: lead.name }, defaults: { siteAddress: lead.location } })}
                  action={createSiteVisit}
                  successMessage="Site visit scheduled"
                />
              )}
            </CardHeader>
            <CardBody className="space-y-2 py-3">
              {lead.siteVisits.length === 0 && <p className="text-sm text-slate-500">No visits yet.</p>}
              {lead.siteVisits.map((v) => (
                <div key={v.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-medium text-slate-900">{formatDate(v.visitDate)}{v.visitTime ? ` · ${v.visitTime}` : ""}</p>
                  <p className="text-slate-600">{v.siteAddress}</p>
                  <div className="mt-1">{v.completed ? <Badge tone="green">Completed</Badge> : <Badge tone="amber">Scheduled</Badge>}</div>
                </div>
              ))}
              {lead.siteVisits.length > 0 && <Link href="/crm/site-visits" className="text-sm font-medium text-brand-700 hover:underline">All site visits →</Link>}
            </CardBody>
          </Card>

          {c.can("documents:view") && <DocumentsPanel c={c} entityType="LEAD" entityId={id} />}

          <Card>
            <CardHeader><CardTitle>Client</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              {lead.client ? (
                <p className="text-sm">
                  Converted to <Link className="font-medium text-brand-700 hover:underline" href={`/crm/clients/${lead.client.id}`}>{lead.client.name} ({lead.client.code})</Link>
                </p>
              ) : (
                <>
                  <p className="text-sm text-slate-500">Once the customer is serious, convert them so quotations and projects can be created.</p>
                  {c.can("clients:create") && <ActionButton size="sm" action={convertLeadToClient.bind(null, id)}>Convert to client</ActionButton>}
                </>
              )}
            </CardBody>
          </Card>

          {c.can("leads:delete") && (
            <ActionButton
              variant="ghost"
              className="text-red-600 hover:bg-red-50"
              action={async () => {
                "use server";
                const r = await deleteLead(id);
                if (r.ok) redirect("/crm/leads");
                return r;
              }}
              confirm={{ title: "Delete this lead?", body: "It will be removed from the pipeline. This can't be undone from the app.", confirmLabel: "Delete lead" }}
            >
              Delete lead
            </ActionButton>
          )}
        </div>
      </div>
    </>
  );
}
