import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FileDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { PM_ROLES, userOptions } from "@/lib/lookups";
import { BOQ_CATEGORIES } from "@/lib/enums";
import { computeTotals } from "@/lib/money";
import { formatDate, formatDateTime, formatINR, humanize, num, toDateInput } from "@/lib/utils";
import { PageHeader, DetailGrid, Alert } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { ActionButton } from "@/components/forms/action-button";
import { convertQuotationToProject, deleteQuotation, markQuotationSent, reviseQuotation, setQuotationStatus, submitQuotation } from "../actions";

export default async function QuotationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requirePerm("quotations:view");
  const q = await db.quotation.findFirst({
    where: { id, companyId: c.companyId, deletedAt: null },
    include: {
      client: true, lead: { select: { id: true, code: true, name: true } },
      items: { orderBy: { sortOrder: "asc" } }, revisions: { orderBy: { revision: "desc" } },
    },
  });
  if (!q) notFound();
  // Sales may only open quotations they prepared or that belong to their leads
  if (c.role === "SALES") {
    const own = q.preparedById === c.userId || (q.leadId && (await db.lead.findFirst({ where: { id: q.leadId, assignedToId: c.userId }, select: { id: true } })));
    if (!own) redirect("/forbidden");
  }

  const [pms, preparer, project, pendingApproval] = await Promise.all([
    userOptions(c.companyId, PM_ROLES),
    q.preparedById ? db.user.findUnique({ where: { id: q.preparedById }, select: { name: true } }) : null,
    q.projectId ? db.project.findUnique({ where: { id: q.projectId }, select: { id: true, code: true, name: true } }) : null,
    q.status === "PENDING_APPROVAL" ? db.approval.findFirst({ where: { companyId: c.companyId, entityType: "Quotation", entityId: id, status: "PENDING" } }) : null,
  ]);

  const t = computeTotals(q.items.map((i) => ({ quantity: num(i.quantity), rate: num(i.rate), taxPercent: num(i.taxPercent) })), { pct: num(q.discountPct) });
  const edit = c.can("quotations:edit");
  const grouped = BOQ_CATEGORIES.map((cat) => ({ cat, items: q.items.map((it, idx) => ({ it, idx })).filter((x) => x.it.category === cat) })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader
        back={{ href: "/sales/quotations", label: "Quotations" }}
        title={`${q.number}${q.revision > 1 ? ` · rev ${q.revision}` : ""}`}
        subtitle={<>{q.client.name}{q.title ? ` · ${q.title}` : ""}</>}
        actions={
          <>
            <StatusBadge status={q.status} />
            <a href={`/sales/quotations/${id}/pdf`} target="_blank" rel="noreferrer"><Button variant="secondary" size="sm"><FileDown className="h-4 w-4" /> PDF</Button></a>
            {edit && ["DRAFT", "REJECTED"].includes(q.status) && <Link href={`/sales/quotations/${id}/edit`}><Button variant="secondary" size="sm">Edit</Button></Link>}
            {edit && ["DRAFT", "REJECTED"].includes(q.status) && (
              <ActionButton size="sm" action={submitQuotation.bind(null, id)}>Submit for approval</ActionButton>
            )}
            {edit && q.status === "APPROVED" && <ActionButton size="sm" action={markQuotationSent.bind(null, id)}>Mark as sent</ActionButton>}
            {edit && q.status === "SENT" && <ActionButton size="sm" variant="secondary" action={setQuotationStatus.bind(null, id, "VIEWED")}>Client viewed</ActionButton>}
            {edit && ["SENT", "VIEWED"].includes(q.status) && <ActionButton size="sm" variant="secondary" action={setQuotationStatus.bind(null, id, "NEGOTIATION")}>In negotiation</ActionButton>}
            {edit && ["SENT", "VIEWED", "NEGOTIATION"].includes(q.status) && (
              <>
                <ActionButton size="sm" variant="success" action={setQuotationStatus.bind(null, id, "ACCEPTED")} confirm={{ title: "Mark as accepted?", body: "The linked lead will be marked Won.", confirmLabel: "Accepted" }}>Client accepted</ActionButton>
                <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={setQuotationStatus.bind(null, id, "REJECTED")} confirm={{ title: "Mark as rejected by client?", confirmLabel: "Rejected" }}>Client rejected</ActionButton>
              </>
            )}
            {edit && !q.projectId && !["DRAFT", "PENDING_APPROVAL"].includes(q.status) && (
              <FormDialog
                title={`Revise ${q.number}`}
                description="Keeps the current version in the history and returns the quotation to Draft (it will need approval again)."
                trigger={<Button size="sm" variant="secondary">Revise</Button>}
                fields={[{ name: "reason", label: "Reason for revision", type: "textarea" }]}
                action={reviseQuotation.bind(null, id)}
                submitLabel="Start revision"
              />
            )}
            {q.status === "ACCEPTED" && !q.projectId && c.can("projects:create") && (
              <FormDialog
                title="Create project"
                description="Creates the project and a draft BOQ from this quotation's line items."
                wide
                trigger={<Button size="sm">Convert to project</Button>}
                fields={[
                  { name: "name", label: "Project name", defaultValue: q.title ?? `${q.client.name} – Interior`, full: true },
                  { name: "projectManagerId", label: "Project manager", type: "select", options: pms, required: true },
                  { name: "startDate", label: "Start date", type: "date", defaultValue: toDateInput(new Date()) },
                  { name: "plannedEndDate", label: "Planned completion", type: "date" },
                  { name: "siteAddress", label: "Site address", full: true, defaultValue: q.client.address },
                ]}
                action={convertQuotationToProject.bind(null, id)}
                submitLabel="Create project"
              />
            )}
            {c.can("quotations:delete") && ["DRAFT", "REJECTED", "EXPIRED"].includes(q.status) && (
              <ActionButton size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" action={async () => { "use server"; const r = await deleteQuotation(id); if (r.ok) redirect("/sales/quotations"); return r; }} confirm={{ title: "Delete this quotation?", confirmLabel: "Delete" }}>Delete</ActionButton>
            )}
          </>
        }
      />

      {pendingApproval && (
        <div className="mb-4"><Alert tone="warn">Waiting for approval from <b>{humanize(pendingApproval.requiredRole)}</b>. <Link href="/approvals" className="font-medium underline">Open approvals</Link></Alert></div>
      )}
      {q.status === "REJECTED" && <div className="mb-4"><Alert tone="bad">This quotation was rejected. Edit it and submit again.</Alert></div>}
      {project && <div className="mb-4"><Alert tone="good">Converted to project <Link className="font-medium underline" href={`/projects/${project.id}`}>{project.code} – {project.name}</Link>.</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-2 text-left">#</th><th className="px-4 py-2 text-left">Description</th><th className="px-4 py-2 text-left">Unit</th><th className="px-4 py-2 text-right">Qty</th><th className="px-4 py-2 text-right">Rate</th><th className="px-4 py-2 text-right">GST</th><th className="px-4 py-2 text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {grouped.map((g) => (
                    <GroupRows key={g.cat} label={humanize(g.cat)} rows={g.items} amounts={t.lines.map((l) => l.amount)} />
                  ))}
                </tbody>
              </table>
            </div>
            <CardBody className="flex justify-end">
              <dl className="tabular w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatINR(q.subtotal, true)}</dd></div>
                {num(q.discountAmount) > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount ({num(q.discountPct)}%)</dt><dd>− {formatINR(q.discountAmount, true)}</dd></div>}
                <div className="flex justify-between"><dt className="text-slate-500">GST</dt><dd>{formatINR(q.taxAmount, true)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900"><dt>Total</dt><dd>{formatINR(q.total, true)}</dd></div>
              </dl>
            </CardBody>
          </Card>
          {(q.terms || q.paymentTerms || q.notes) && (
            <Card>
              <CardHeader><CardTitle>Terms</CardTitle></CardHeader>
              <CardBody className="space-y-4 text-sm text-slate-700">
                {q.paymentTerms && <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment terms</p><p className="mt-1 whitespace-pre-wrap">{q.paymentTerms}</p></div>}
                {q.terms && <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Terms &amp; conditions</p><p className="mt-1 whitespace-pre-wrap">{q.terms}</p></div>}
                {q.notes && <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes</p><p className="mt-1 whitespace-pre-wrap">{q.notes}</p></div>}
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardBody>
              <DetailGrid items={[
                { label: "Client", value: <Link className="text-brand-700 hover:underline" href={`/crm/clients/${q.client.id}`}>{q.client.name}</Link> },
                { label: "Lead", value: q.lead ? <Link className="text-brand-700 hover:underline" href={`/crm/leads/${q.lead.id}`}>{q.lead.code} · {q.lead.name}</Link> : null },
                { label: "Date", value: formatDate(q.date) }, { label: "Valid until", value: formatDate(q.validUntil) },
                { label: "Prepared by", value: preparer?.name },
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>Revision history</CardTitle></CardHeader>
            <CardBody className="space-y-2 py-3">
              <div className="flex items-center justify-between text-sm"><span className="font-medium">Rev {q.revision} (current)</span><span className="tabular">{formatINR(q.total)}</span></div>
              {q.revisions.map((r) => (
                <div key={r.id} className="border-t border-slate-100 pt-2 text-sm">
                  <div className="flex items-center justify-between"><span>Rev {r.revision}</span><span className="tabular text-slate-600">{formatINR(r.total)}</span></div>
                  <p className="text-xs text-slate-500">{formatDateTime(r.createdAt)}{r.reason ? ` · ${r.reason}` : ""}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function GroupRows({ label, rows, amounts }: { label: string; rows: { it: { id: string; description: string; unit: string; quantity: unknown; rate: unknown; taxPercent: unknown }; idx: number }[]; amounts: number[] }) {
  return (
    <>
      <tr className="bg-brand-50/70"><td colSpan={7} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-brand-800">{label}</td></tr>
      {rows.map(({ it, idx }) => (
        <tr key={it.id} className="border-t border-slate-100">
          <td className="px-4 py-2.5 text-slate-400">{idx + 1}</td>
          <td className="max-w-md px-4 py-2.5 text-slate-800">{it.description}</td>
          <td className="px-4 py-2.5">{it.unit}</td>
          <td className="tabular px-4 py-2.5 text-right">{num(it.quantity as number)}</td>
          <td className="tabular px-4 py-2.5 text-right">{formatINR(it.rate as number, true)}</td>
          <td className="tabular px-4 py-2.5 text-right">{num(it.taxPercent as number)}%</td>
          <td className="tabular px-4 py-2.5 text-right font-medium">{formatINR(amounts[idx], true)}</td>
        </tr>
      ))}
    </>
  );
}
