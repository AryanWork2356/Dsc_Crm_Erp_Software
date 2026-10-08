import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatINR, humanize, num, startOfDay } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatCard, Progress, EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "My Projects" };

export default async function ClientHome() {
  const c = await requireCtx();
  if (c.role !== "CLIENT" || !c.clientId) redirect("/");
  const [client, projects, invoices, quotes, tickets] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: c.clientId } }),
    db.project.findMany({ where: { companyId: c.companyId, clientId: c.clientId, deletedAt: null }, include: { milestones: { orderBy: { dueDate: "asc" } } }, orderBy: { createdAt: "desc" } }),
    db.invoice.findMany({ where: { companyId: c.companyId, clientId: c.clientId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE", "PAID"] } } }),
    db.quotation.count({ where: { companyId: c.companyId, clientId: c.clientId, deletedAt: null, status: { in: ["SENT", "VIEWED", "NEGOTIATION"] } } }),
    db.supportTicket.count({ where: { companyId: c.companyId, clientId: c.clientId, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
  ]);
  const due = invoices.filter((i) => i.status !== "PAID").reduce((s, i) => s + num(i.total) - num(i.paid), 0);
  const overdue = invoices.filter((i) => i.status !== "PAID" && i.dueDate && i.dueDate < startOfDay()).reduce((s, i) => s + num(i.total) - num(i.paid), 0);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-semibold tracking-tight text-slate-900">Hello, {client.name.split(" ")[0]}</h1><p className="mt-1 text-sm text-slate-500">Here&apos;s where your interior projects stand.</p></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Projects" value={projects.length} />
        <StatCard label="Amount due" value={formatINR(due)} tone={overdue ? "bad" : due ? "warn" : "good"} href="/portal/invoices" sub={overdue ? `${formatINR(overdue)} overdue` : undefined} />
        <StatCard label="Quotations to review" value={quotes} tone={quotes ? "warn" : "default"} href="/portal/quotations" />
        <StatCard label="Open requests" value={tickets} href="/portal/support" />
      </div>
      {projects.length === 0 ? <Card><EmptyState title="No projects yet" hint="Your project will appear here once your quotation is accepted." /></Card> : projects.map((p) => {
        const next = p.milestones.find((m) => !m.completedAt);
        const toApprove = p.milestones.filter((m) => m.completedAt && !m.clientApproved).length;
        return (
          <Card key={p.id}>
            <CardHeader><div><Link href={`/portal/projects/${p.id}`} className="text-base font-semibold text-slate-900 hover:text-brand-700">{p.name}</Link><p className="text-xs text-slate-500">{p.code} · {humanize(p.segment)}</p></div><StatusBadge status={p.status} /></CardHeader>
            <CardBody className="space-y-3">
              <div><div className="mb-1 flex justify-between text-sm"><span className="text-slate-600">Overall progress</span><span className="font-semibold">{p.progress}%</span></div><Progress value={p.progress} /></div>
              <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-slate-600"><span>Start: <b className="text-slate-900">{formatDate(p.startDate)}</b></span><span>Expected completion: <b className="text-slate-900">{formatDate(p.plannedEndDate)}</b></span>{next && <span>Next stage: <b className="text-slate-900">{next.name}</b></span>}</div>
              {toApprove > 0 && <Link href={`/portal/projects/${p.id}`} className="inline-block rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200">{toApprove} completed stage(s) waiting for your approval →</Link>}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
