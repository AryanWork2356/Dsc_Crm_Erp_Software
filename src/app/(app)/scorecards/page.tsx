import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { bandTone, projectMetrics, scoreProject } from "@/lib/scorecard";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "Performance scorecards" };

export default async function ScorecardsPage() {
  const c = await requirePerm("scorecards:view");
  const projects = await db.project.findMany({
    where: { ...projectScope(c), status: { in: ["EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER", "COMPLETED"] } },
    select: { id: true, code: true, name: true, status: true, projectManagerId: true, supervisorId: true }, orderBy: { code: "asc" }, take: 60,
  });
  const rows = await Promise.all(projects.map(async (p) => {
    const m = await projectMetrics(c.companyId, p.id);
    return { p, score: scoreProject(m, m.review), reviewed: !!m.review };
  }));
  const users = await db.user.findMany({ where: { id: { in: [...new Set(projects.flatMap((p) => [p.projectManagerId, p.supervisorId]).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));

  const people = new Map<string, { role: string; scores: number[] }>();
  for (const { p, score } of rows) {
    for (const [id, role] of [[p.projectManagerId, "Project manager"], [p.supervisorId, "Project coordinator"]] as const) {
      if (!id) continue;
      const e = people.get(id) ?? { role, scores: [] };
      e.scores.push(score.total);
      people.set(id, e);
    }
  }
  const avg = (a: number[]) => Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10;

  return (
    <div>
      <PageHeader title="Performance scorecards" subtitle="Every project is scored out of 100 from real records: dates, reports, deliveries, budget and documents, plus a short review of quality and the client's rating." />
      {rows.length === 0 ? <EmptyState title="No projects to score yet" hint="Scorecards appear for projects in execution and later stages." /> : (
        <>
          {people.size > 0 && (
            <Card className="mb-6">
              <CardHeader><CardTitle>People – average score across their projects</CardTitle></CardHeader>
              <ul className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
                {[...people.entries()].sort((a, b) => avg(b[1].scores) - avg(a[1].scores)).map(([id, e]) => (
                  <li key={id} className="flex items-center justify-between gap-3 bg-white px-5 py-3.5">
                    <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-900">{name.get(id)}</p><p className="text-xs text-slate-500">{e.role} · {e.scores.length} project(s)</p></div>
                    <span className="tabular text-lg font-semibold text-slate-900">{avg(e.scores)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Projects</CardTitle></CardHeader>
            <ul className="divide-y divide-slate-100">
              {rows.sort((a, b) => b.score.total - a.score.total).map(({ p, score, reviewed }) => (
                <li key={p.id}>
                  <Link href={`/scorecards/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{p.code} · {p.name} <StatusBadge status={p.status} /></p>
                      <p className="text-xs text-slate-500">PM {name.get(p.projectManagerId ?? "") ?? "—"} · supervisor {name.get(p.supervisorId ?? "") ?? "—"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!reviewed && <Badge tone="slate">Provisional</Badge>}
                      <Badge tone={bandTone(score.label)}>{score.label}</Badge>
                      <span className="tabular w-14 text-right text-lg font-semibold text-slate-900">{score.total}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
