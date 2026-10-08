import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { PRIORITY_OPTS } from "@/lib/enums";
import { warrantyUntil } from "@/lib/warranty";
import { formatDate } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/page";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { createClientTicket } from "../actions";

export const metadata = { title: "Support & Warranty" };

export default async function ClientSupport() {
  const c = await requireCtx();
  if (c.role !== "CLIENT" || !c.clientId) redirect("/");
  const [tickets, projects] = await Promise.all([
    db.supportTicket.findMany({ where: { companyId: c.companyId, clientId: c.clientId }, include: { project: { select: { name: true } }, claims: true }, orderBy: { createdAt: "desc" } }),
    db.project.findMany({ where: { companyId: c.companyId, clientId: c.clientId, deletedAt: null }, select: { id: true, name: true, status: true, actualEndDate: true } }),
  ]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Support & warranty</h1>
        <FormDialog title="Report an issue" description="Describe the problem – photos can be sent on WhatsApp to our team. We'll assign it right away." trigger={<Button>Report an issue</Button>} fields={[{ name: "projectId", label: "Which project?", type: "select", options: projects.map((p) => ({ value: p.id, label: p.name })) }, { name: "subject", label: "What's the problem?", required: true, full: true }, { name: "priority", label: "How urgent?", type: "select", options: PRIORITY_OPTS, defaultValue: "MEDIUM" }, { name: "description", label: "Details", type: "textarea" }]} action={createClientTicket} submitLabel="Send request" />
      </div>
      {projects.some((p) => warrantyUntil(p)) && (
        <Card><CardHeader><CardTitle>Warranty cover</CardTitle></CardHeader><CardBody className="space-y-1.5 text-sm">
          {projects.filter((p) => warrantyUntil(p)).map((p) => { const until = warrantyUntil(p)!; const live = until >= new Date(); return <div key={p.id} className="flex items-center justify-between"><span>{p.name}</span>{live ? <Badge tone="green">Covered until {formatDate(until)}</Badge> : <Badge tone="slate">Ended {formatDate(until)}</Badge>}</div>; })}
        </CardBody></Card>
      )}
      <Card>
        <CardHeader><CardTitle>Your requests</CardTitle></CardHeader>
        {tickets.length === 0 ? <EmptyState title="No requests" hint="If something isn't right after handover, let us know here." /> : (
          <ul className="divide-y divide-slate-100">{tickets.map((t) => (
            <li key={t.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{t.subject}</p><p className="text-xs text-slate-500">{t.number} · {t.project?.name ?? "General"} · {formatDate(t.createdAt)}</p></div>{t.isWarranty && <Badge tone="teal">Under warranty</Badge>}<StatusBadge status={t.status} /></div>
              {t.resolution && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t.resolution}</p>}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
