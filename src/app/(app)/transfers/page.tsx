import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten } from "@/lib/list";
import { canDecideTransfer, type ManpowerLine, type MaterialLine } from "@/lib/transfers";
import { formatDateTime, humanize } from "@/lib/utils";
import { PageHeader, EmptyState, TabLinks } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/forms/action-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { decideTransfer } from "./actions";
import { USE_SITE_MATERIAL } from "@/lib/features";
import { notFound } from "next/navigation";

export const metadata = { title: "Transfers between projects" };
const WIDE = ["OWNER", "MANAGEMENT", "ADMIN"];

export default async function TransfersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!USE_SITE_MATERIAL) notFound(); // switched off at DSC (lib/features.ts)
  const c = await requirePerm("transfers:view");
  const sp = flatten(await searchParams);
  const tab = sp.tab === "all" ? "all" : "pending";

  let where: Prisma.TransferRequestWhereInput = { companyId: c.companyId, ...(tab === "pending" ? { status: "PENDING" } : {}) };
  if (!WIDE.includes(c.role)) {
    const mine = (await db.project.findMany({ where: projectScope(c), select: { id: true } })).map((p) => p.id);
    where = { ...where, OR: [{ requestedById: c.userId }, { fromProjectId: { in: mine } }, { toProjectId: { in: mine } }] };
  }
  const rows = await db.transferRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 60 });

  const projects = await db.project.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.fromProjectId, r.toProjectId]))] } }, select: { id: true, code: true, name: true, projectManagerId: true } });
  const proj = new Map(projects.map((p) => [p.id, p]));
  const matIds = rows.flatMap((r) => (r.kind === "MATERIAL" ? (r.items as unknown as MaterialLine[]).map((l) => l.materialId) : []));
  const workerIds = rows.flatMap((r) => (r.kind === "MANPOWER" ? (r.items as unknown as ManpowerLine[]).map((l) => l.workerId) : []));
  const [mats, workers, users] = await Promise.all([
    db.material.findMany({ where: { id: { in: matIds } }, select: { id: true, name: true, unit: true } }),
    db.worker.findMany({ where: { id: { in: workerIds } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter(Boolean) as string[]))] } }, select: { id: true, name: true } }),
  ]);
  const mat = new Map(mats.map((m) => [m.id, m]));
  const wk = new Map(workers.map((w) => [w.id, w.name]));
  const who = new Map(users.map((u) => [u.id, u.name]));
  const pendingCount = tab === "pending" ? rows.length : await db.transferRequest.count({ where: { ...where, status: "PENDING" } });

  return (
    <div>
      <PageHeader
        title="Transfers between projects"
        subtitle="Material or workers moving from one project to another need the approval of the project they leave."
        actions={c.can("transfers:create") ? <Button asChild><Link href="/transfers/new">New transfer</Link></Button> : undefined}
      />
      <div className="mb-4"><TabLinks current={tab} tabs={[{ key: "pending", label: "Waiting for approval", href: "/transfers", count: pendingCount }, { key: "all", label: "All transfers", href: "/transfers?tab=all" }]} /></div>
      {rows.length === 0 ? (
        <EmptyState title={tab === "pending" ? "Nothing waiting" : "No transfers yet"} hint="Raise a transfer when material or workers move to another site." />
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const from = proj.get(r.fromProjectId);
            const to = proj.get(r.toProjectId);
            const lines = r.kind === "MATERIAL"
              ? (r.items as unknown as MaterialLine[]).map((l) => `${mat.get(l.materialId)?.name ?? "Material"} × ${l.quantity} ${mat.get(l.materialId)?.unit ?? ""}`)
              : (r.items as unknown as ManpowerLine[]).map((l) => wk.get(l.workerId) ?? "Worker");
            const canDecide = r.status === "PENDING" && c.can("transfers:approve") && canDecideTransfer(c, from?.projectManagerId ?? null) && (r.requestedById !== c.userId || c.role === "OWNER");
            return (
              <Card key={r.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {r.number} <Badge tone={r.kind === "MATERIAL" ? "blue" : "purple"}>{humanize(r.kind)}</Badge> {r.emergency && <Badge tone="red">Emergency</Badge>}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
                      <span className="font-medium">{from?.code}</span> <span className="text-slate-500">{from?.name}</span> <ArrowRight className="h-4 w-4 text-slate-400" /> <span className="font-medium">{to?.code}</span> <span className="text-slate-500">{to?.name}</span>
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-2 text-sm text-slate-700">{lines.join(" · ")}</p>
                {r.reason && <p className="mt-1 text-sm text-slate-500">Reason: {r.reason}</p>}
                <p className="mt-2 text-xs text-slate-500">Asked by {who.get(r.requestedById) ?? "—"} on {formatDateTime(r.createdAt)}{r.decidedAt ? ` · ${r.status === "APPROVED" ? "approved" : "rejected"} by ${who.get(r.decidedById ?? "") ?? "—"} on ${formatDateTime(r.decidedAt)}` : ""}{r.decisionNote ? ` · “${r.decisionNote}”` : ""}</p>
                {canDecide && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionButton action={decideTransfer.bind(null, r.id, true)} confirm={{ title: `Approve ${r.number}?`, body: r.kind === "MATERIAL" ? "The material moves between the two site stores and the cost moves with it." : "The workers are moved to the new project.", confirmLabel: "Approve" }}>Approve</ActionButton>
                    <FormDialog title={`Reject ${r.number}`} trigger={<Button variant="secondary">Reject</Button>} fields={[{ name: "note", label: "Reason", type: "textarea", required: true, full: true }]} action={decideTransfer.bind(null, r.id, false)} submitLabel="Reject" />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
