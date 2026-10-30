import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { todayPlan, type PlanTask } from "@/lib/today-plan";
import { formatDate, cn } from "@/lib/utils";
import { PageHeader, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskStatusControl } from "../projects/task-controls";
import { setTaskStatus } from "../projects/actions";

export const metadata = { title: "Today's Plan" };

function Row({ t, kind, canEdit }: { t: PlanTask; kind: "today" | "late" | "soon"; canEdit: boolean }) {
  const crew = [t.people ? `${t.people} ${t.people === 1 ? "person" : "people"}` : null, t.trade].filter(Boolean).join(" · ");
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">
            {t.name}
            {kind === "today" && t.of && t.of > 1 && <span className="ml-2 text-xs font-normal text-slate-500">day {t.day} of {t.of}</span>}
            {kind === "late" && <Badge tone="red" className="ml-2">{t.daysLate} day{t.daysLate === 1 ? "" : "s"} late</Badge>}
            {kind === "soon" && <Badge tone="blue" className="ml-2">{t.startsIn === 1 ? "starts tomorrow" : `starts in ${t.startsIn} days`}</Badge>}
            {t.status === "BLOCKED" && <Badge tone="red" className="ml-2">Blocked</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[t.zone, crew, t.plannedQty ? `${t.actualQty ?? 0} / ${t.plannedQty} ${t.unit ?? ""}`.trim() : null, t.due ? `finish by ${formatDate(t.due)}` : null].filter(Boolean).join(" · ")}
          </p>
          {t.status === "BLOCKED" && t.blockedReason && <p className="mt-1 text-xs font-medium text-red-700">Why: {t.blockedReason}</p>}
          {t.waitingFor && <p className="mt-1 text-xs font-medium text-amber-700">Waiting for: {t.waitingFor}</p>}
        </div>
        <div className="w-24 shrink-0 text-right text-xs text-slate-500"><span className="tabular text-sm font-semibold text-slate-800">{t.progress}%</span> done</div>
        {kind !== "soon" && <TaskStatusControl status={t.status} progress={t.progress} disabled={!canEdit} action={setTaskStatus.bind(null, t.id)} />}
      </div>
    </li>
  );
}

export default async function TodayPage() {
  const c = await requirePerm("tasks:view");
  const plan = await todayPlan(c);
  const canEdit = c.can("tasks:edit");
  const siteRole = c.role === "SITE_SUPERVISOR" || c.role === "SITE_ENGINEER";
  const dayName = plan.day.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <>
      <PageHeader
        title="Today's Plan"
        subtitle={`${dayName}. What is to be done on your projects today, what is running late, and what starts in the next 3 days. It comes from each project's schedule.`}
        actions={siteRole && <Link href="/site-reports/new?kind=MORNING"><Button>Send morning update</Button></Link>}
      />
      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatCard label="To do today" value={plan.counts.today} tone="default" />
        <StatCard label="Running late" value={plan.counts.late} tone={plan.counts.late ? "bad" : "good"} />
        <StatCard label="Starting soon" value={plan.counts.soon} />
      </div>
      {plan.projects.length === 0 ? (
        <Card><EmptyState title="Nothing is scheduled" hint="When the Project Manager uploads the schedule (Project → Schedule → Upload schedule), the work of each day appears here." /></Card>
      ) : plan.projects.map((p) => (
        <Card key={p.id} className="mb-5">
          <CardHeader><CardTitle><Link href={`/projects/${p.id}?tab=schedule`} className="hover:text-brand-700">{p.code} · {p.name}</Link></CardTitle></CardHeader>
          {([["late", "Running late", p.late], ["today", "Today", p.today], ["soon", "Starting in the next 3 days", p.soon]] as const).map(([kind, title, list]) => list.length > 0 && (
            <div key={kind}>
              <p className={cn("border-t border-slate-100 bg-slate-50 px-5 py-2 text-xs font-semibold uppercase tracking-wide", kind === "late" ? "text-red-700" : "text-slate-500")}>{title} ({list.length})</p>
              <ul className="divide-y divide-slate-100">{list.map((t) => <Row key={t.id} t={t} kind={kind} canEdit={canEdit} />)}</ul>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}
