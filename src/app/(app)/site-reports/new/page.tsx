import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { flatten } from "@/lib/list";
import { dueLabel, reportDay } from "@/lib/site-reports";
import { reportTimes } from "@/lib/site-report-reminders";
import { PageHeader } from "@/components/ui/page";
import { ReportForm } from "../report-form";
import { siteDay, workLine } from "@/lib/site-day";

export const metadata = { title: "Send site report" };

const OPEN = ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER", "ON_HOLD"] as const;

export default async function NewSiteReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const c = await requirePerm("site_reports:create");
  const sp = flatten(await searchParams);
  const kind = sp.kind === "EVENING" ? "EVENING" : "MORNING";

  const projects = await db.project.findMany({ where: { ...projectScope(c), status: { in: [...OPEN] } }, select: { id: true, code: true, name: true, outstation: true }, orderBy: { code: "asc" } });
  const chosen = projects.find((p) => p.id === sp.project) ?? projects[0];
  if (!chosen) notFound();

  const [t, existing, day, late] = await Promise.all([
    reportTimes(c.companyId),
    db.dailyReport.findUnique({ where: { projectId_reportDate_kind: { projectId: chosen.id, reportDate: reportDay(), kind } } }),
    siteDay(c.companyId, chosen.id),
    kind === "EVENING" ? db.lateWork.findUnique({ where: { projectId_date: { projectId: chosen.id, date: reportDay() } } }) : null,
  ]);

  return (
    <div>
      <PageHeader
        back={{ href: "/site-reports", label: "Today's reports" }}
        title={kind === "MORNING" ? "Morning update" : "Evening report"}
        subtitle={`${chosen.code} – ${chosen.name} · due by ${dueLabel(kind, chosen.outstation, t, late?.until)}${existing ? " · already sent today – saving will update it" : ""}`}
      />
      <ReportForm
        key={`${chosen.id}-${kind}`} kind={kind} projectId={chosen.id}
        sites={projects.map((p) => ({ id: p.id, label: `${p.code} – ${p.name}` }))}
        canUpdateTasks={c.can("tasks:edit")}
        day={{ tasks: kind === "MORNING" ? day.todayTasks : day.todayTasks, crew: day.crew }}
        initial={{
          manpower: existing?.manpower ?? (kind === "EVENING" ? day.morningManpower : null) ?? 0, workDone: existing?.workDone ?? "",
          planNext: existing?.planNext ?? workLine(kind === "MORNING" ? day.todayTasks : day.tomorrowTasks),
          materialStatus: existing?.materialStatus ?? "OK", issues: existing?.issues ?? "", existingPhotos: existing?.photoIds.length ?? 0,
        }}
      />
    </div>
  );
}
