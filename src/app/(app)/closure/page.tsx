import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { loadClosure, CLOSURE_DEADLINE_DAYS } from "@/lib/closure";
import { formatDate } from "@/lib/utils";
import { PageHeader, EmptyState, Progress } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/forms/action-button";
import { startClosure } from "./actions";

export const metadata = { title: "Project closure" };

export default async function ClosurePage() {
  const c = await requirePerm("closure:view");
  const scope = projectScope(c);
  const [withList, candidates] = await Promise.all([
    db.projectClosure.findMany({ where: { companyId: c.companyId, project: scope }, include: { project: { select: { id: true, code: true, name: true, status: true, actualEndDate: true } } }, orderBy: { startedAt: "desc" } }),
    db.project.findMany({ where: { ...scope, status: { in: ["SNAGGING", "HANDOVER", "COMPLETED"] }, closure: null }, select: { id: true, code: true, name: true, status: true } }),
  ]);
  const views = await Promise.all(withList.map(async (r) => ({ r, v: await loadClosure(c.companyId, r.projectId) })));

  return (
    <div>
      <PageHeader title="Project closure" subtitle={`After handover, 15 documents and checks must be complete within ${CLOSURE_DEADLINE_DAYS} days. Then the closure report goes to the directors.`} />
      {candidates.length > 0 && c.can("closure:create") && (
        <Card className="mb-5 p-5">
          <p className="mb-3 text-sm font-semibold text-slate-900">Projects ready for a closure checklist</p>
          <ul className="space-y-2">
            {candidates.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><span className="font-medium">{p.code}</span> {p.name} <StatusBadge status={p.status} /></span>
                <ActionButton size="sm" action={startClosure.bind(null, p.id)}>Start checklist</ActionButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {views.length === 0 ? <EmptyState title="No closure checklists yet" hint="One starts automatically when a project moves to Handover." /> : (
        <div className="space-y-3">
          {views.map(({ r, v }) => {
            const days = Math.floor((Date.now() - r.startedAt.getTime()) / 86400000);
            const late = r.status === "OPEN" && days > CLOSURE_DEADLINE_DAYS;
            return (
              <Link key={r.id} href={`/closure/${r.projectId}`} className="block">
                <Card className="p-5 transition-shadow hover:shadow-md">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{r.project.code} · {r.project.name}</p>
                    <div className="flex items-center gap-2">
                      {late && <Badge tone="red">{days - CLOSURE_DEADLINE_DAYS} days past the {CLOSURE_DEADLINE_DAYS}-day limit</Badge>}
                      <Badge tone={r.status === "CLOSED" ? "green" : r.status === "SUBMITTED" ? "blue" : "amber"}>{r.status === "CLOSED" ? "Closed" : r.status === "SUBMITTED" ? "With directors" : "In progress"}</Badge>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={v ? (v.done / v.total) * 100 : 0} className="flex-1" />
                    <span className="tabular text-sm font-medium text-slate-700">{v?.done}/{v?.total}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Started {formatDate(r.startedAt)}{r.closedAt ? ` · closed ${formatDate(r.closedAt)}` : ""}</p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-xs text-slate-500"><Button asChild variant="link"><Link href="/projects">All projects</Link></Button></p>
    </div>
  );
}
