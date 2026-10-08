import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { Check, Circle, Download } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatINR, humanize, num } from "@/lib/utils";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, EmptyState, DetailGrid } from "@/components/ui/page";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/forms/action-button";
import { approveMilestone } from "../../actions";

export default async function ClientProject({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await requireCtx();
  if (c.role !== "CLIENT" || !c.clientId) redirect("/");
  const p = await db.project.findFirst({
    where: { id, companyId: c.companyId, clientId: c.clientId, deletedAt: null },
    include: { milestones: { orderBy: [{ dueDate: "asc" }, { name: "asc" }] }, tasks: { where: { status: "COMPLETED" }, orderBy: { updatedAt: "desc" }, take: 6 } },
  });
  if (!p) notFound();
  const [docs, boq] = await Promise.all([
    db.document.findMany({ where: { companyId: c.companyId, entityType: "PROJECT", entityId: id, isPortalVisible: true, deletedAt: null }, orderBy: { createdAt: "desc" } }),
    db.boq.findFirst({ where: { projectId: id, deletedAt: null, status: "APPROVED" }, include: { items: { select: { category: true, total: true } } }, orderBy: { revision: "desc" } }),
  ]);
  const photos = docs.filter((d) => d.mimeType.startsWith("image/"));
  const files = docs.filter((d) => !d.mimeType.startsWith("image/"));
  const byCat = new Map<string, number>();
  for (const i of boq?.items ?? []) byCat.set(i.category, (byCat.get(i.category) ?? 0) + num(i.total));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight text-slate-900">{p.name}</h1><StatusBadge status={p.status} /></div>
      <Card><CardBody className="space-y-4">
        <div><div className="mb-1 flex justify-between text-sm"><span className="text-slate-600">Overall progress</span><span className="font-semibold">{p.progress}%</span></div><Progress value={p.progress} /></div>
        <DetailGrid items={[{ label: "Site", value: p.siteAddress }, { label: "Start date", value: formatDate(p.startDate) }, { label: "Expected completion", value: formatDate(p.plannedEndDate) }]} />
      </CardBody></Card>

      <Card>
        <CardHeader><CardTitle>Stages</CardTitle></CardHeader>
        {p.milestones.length === 0 ? <EmptyState title="Stages will appear here" /> : (
          <ul className="divide-y divide-slate-100">
            {p.milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                {m.completedAt ? <Check className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-slate-300" />}
                <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{m.name}</p><p className="text-xs text-slate-500">{m.completedAt ? `Completed ${formatDate(m.completedAt)}` : `Planned ${formatDate(m.dueDate)}`}</p></div>
                {m.clientApproved ? <Badge tone="green">You approved</Badge> : m.completedAt ? <ActionButton size="sm" variant="success" action={approveMilestone.bind(null, m.id)} confirm={{ title: `Approve “${m.name}”?`, body: "This confirms the stage is complete to your satisfaction.", confirmLabel: "Yes, approve" }}>Approve stage</ActionButton> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {photos.length > 0 && (
        <Card><CardHeader><CardTitle>Site photos</CardTitle></CardHeader><CardBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos.map((d) => <a key={d.id} href={`/documents/${d.id}/download?inline=1`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200"><Image src={`/documents/${d.id}/download?inline=1`} alt={d.name} width={400} height={300} unoptimized className="h-36 w-full object-cover" /><p className="truncate px-2 py-1.5 text-xs text-slate-600">{d.name}</p></a>)}</div>
        </CardBody></Card>
      )}

      {byCat.size > 0 && (
        <Card><CardHeader><CardTitle>Scope & value (approved BOQ {boq?.number})</CardTitle></CardHeader><CardBody className="space-y-1.5 text-sm">
          {[...byCat.entries()].map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-slate-600">{humanize(k)}</span><span className="tabular font-medium">{formatINR(v)}</span></div>)}
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><span>Total (excl. GST)</span><span className="tabular">{formatINR([...byCat.values()].reduce((a, b) => a + b, 0))}</span></div>
        </CardBody></Card>
      )}

      {p.tasks.length > 0 && <Card><CardHeader><CardTitle>Recently completed work</CardTitle></CardHeader><ul className="divide-y divide-slate-100">{p.tasks.map((t) => <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm"><Check className="h-4 w-4 text-emerald-600" /><span className="flex-1">{t.name}</span><span className="text-xs text-slate-500">{formatDate(t.updatedAt)}</span></li>)}</ul></Card>}

      {files.length > 0 && (
        <Card><CardHeader><CardTitle>Documents</CardTitle></CardHeader><ul className="divide-y divide-slate-100">{files.map((d) => <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-sm"><span className="flex-1 font-medium text-slate-900">{d.name}</span><span className="text-xs text-slate-500">{humanize(d.type)} · {formatDate(d.createdAt)}</span><a href={`/documents/${d.id}/download`} className="rounded p-2 text-brand-700 hover:bg-brand-50" aria-label={`Download ${d.name}`}><Download className="h-4 w-4" /></a></li>)}</ul></Card>
      )}
    </div>
  );
}
