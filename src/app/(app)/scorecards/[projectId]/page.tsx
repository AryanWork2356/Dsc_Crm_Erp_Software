import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { bandTone, projectMetrics, scoreProject } from "@/lib/scorecard";
import { cn, formatDate } from "@/lib/utils";
import { PageHeader, Alert, DetailGrid } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { saveProjectReview } from "../actions";

export const metadata = { title: "Project scorecard" };

export default async function ScorecardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const c = await requirePerm("scorecards:view");
  const { projectId } = await params;
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) } });
  if (!p) notFound();
  const m = await projectMetrics(c.companyId, projectId);
  const score = scoreProject(m, m.review);
  const [pm, sup] = await Promise.all([p.projectManagerId ? db.user.findUnique({ where: { id: p.projectManagerId }, select: { name: true } }) : null, p.supervisorId ? db.user.findUnique({ where: { id: p.supervisorId }, select: { name: true } }) : null]);
  const wide = ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role);
  const canReview = c.can("scorecards:edit") && (wide || p.projectManagerId === c.userId);
  const r = m.review;

  return (
    <div>
      <PageHeader
        back={{ href: "/scorecards", label: "Scorecards" }}
        title={`${p.code} · ${p.name}`}
        subtitle={`Project manager: ${pm?.name ?? "—"} · Project coordinator: ${sup?.name ?? "—"}`}
        actions={<>
          <Button asChild variant="secondary" size="sm"><a href={`/scorecards/${projectId}/pdf`} target="_blank" rel="noreferrer"><FileDown className="h-4 w-4" /> Evaluation form (PDF)</a></Button>
          {canReview && (
            <FormDialog title="Performance evaluation" description="The facts are measured automatically. Answer only what a person has to judge." wide trigger={<Button size="sm">{r ? "Edit evaluation" : "Record evaluation"}</Button>}
              fields={[
                { name: "clientRating", label: "Client satisfaction", type: "select", required: true, defaultValue: r?.clientRating ?? "", options: [{ value: "5", label: "5 – Excellent" }, { value: "4", label: "4 – Good" }, { value: "3", label: "3 – Average" }, { value: "2", label: "2 – Poor" }, { value: "1", label: "1 – Very poor" }] },
                { name: "delayInControl", label: "If the project was late: was the delay in the team's control?", type: "select", defaultValue: r?.delayInControl == null ? "" : r.delayInControl ? "yes" : "no", options: [{ value: "", label: "Not late / not applicable" }, { value: "yes", label: "Yes – the team could have avoided it" }, { value: "no", label: "No – client, weather or other cause" }] },
                { name: "delayReason", label: "Reason for delay", type: "textarea", full: true, defaultValue: r?.delayReason ?? "" },
                { name: "reworkRequired", label: "Rework was needed because of our work", type: "checkbox", defaultValue: r?.reworkRequired ?? false },
                { name: "snagClosedOnTime", label: "Snags were closed on time", type: "checkbox", defaultValue: r?.snagClosedOnTime ?? true },
                { name: "labourDiscipline", label: "Labour was managed and disciplined", type: "checkbox", defaultValue: r?.labourDiscipline ?? true },
                { name: "wastageControlled", label: "Material wastage was controlled", type: "checkbox", defaultValue: r?.wastageControlled ?? true },
                { name: "safetyFollowed", label: "Safety rules were followed", type: "checkbox", defaultValue: r?.safetyFollowed ?? true },
                { name: "remarks", label: "Remarks", type: "textarea", full: true, defaultValue: r?.remarks ?? "" },
              ]} action={saveProjectReview.bind(null, projectId)} submitLabel="Save evaluation" />
          )}
        </>}
      />
      {!r && <div className="mb-4"><Alert tone="info">Provisional score – the manager has not recorded the evaluation yet, so quality, client rating and safety count as neutral.</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardBody className="text-center">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Score</p>
            <p className="tabular mt-1 text-5xl font-semibold text-slate-900">{score.total}</p>
            <p className="mt-1 text-sm text-slate-500">out of 100</p>
            <div className="mt-3"><Badge tone={bandTone(score.label)}>{score.label}</Badge></div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>How the score is made</CardTitle></CardHeader>
          <ul className="divide-y divide-slate-100">
            {score.parts.map((x) => (
              <li key={x.key} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-slate-900">{x.label}</p><p className="tabular text-sm font-semibold">{x.points} / {x.max}</p></div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", x.points / x.max >= 0.8 ? "bg-emerald-500" : x.points / x.max >= 0.5 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${(x.points / x.max) * 100}%` }} /></div>
                <p className="mt-1 text-xs text-slate-500">{x.detail}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>Facts measured from the system</CardTitle></CardHeader>
        <CardBody>
          <DetailGrid items={[
            { label: "Planned completion", value: formatDate(m.plannedEnd) },
            { label: "Actual / today", value: formatDate(m.endRef) },
            { label: "Delay", value: m.onTime === null ? "—" : m.onTime ? "On time" : `${m.delayDays} day(s)` },
            { label: "Reports sent", value: `${m.reportsSent} of ${m.reportsExpected} (${m.reportsOnTime} on time)` },
            { label: "Late deliveries", value: m.posWithDate ? `${m.posLate} of ${m.posWithDate}` : "—" },
            { label: "Against budget", value: m.budgetVariancePct === null ? "—" : `${m.budgetVariancePct > 0 ? "+" : ""}${m.budgetVariancePct.toFixed(1)}%` },
            { label: "Closure checklist", value: m.closurePct === null ? "Not started" : `${Math.round(m.closurePct * 100)}%` },
            { label: "Bills still to certify", value: m.uncertifiedBills },
          ]} />
        </CardBody>
      </Card>
    </div>
  );
}
