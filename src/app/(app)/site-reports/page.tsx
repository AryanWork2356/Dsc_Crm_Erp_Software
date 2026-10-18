import Link from "next/link";
import { Camera, Users } from "lucide-react";
import type { ReportKind } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { calendarDay, cn, formatDate } from "@/lib/utils";
import { dueLabel, istParts, MATERIAL_STATUS_LABEL, reportDay, slotState, type SlotState } from "@/lib/site-reports";
import { reportTimes } from "@/lib/site-report-reminders";
import { maybeRunReminders } from "@/lib/reminders";
import { PageHeader, EmptyState } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Daily site reports" };

const LIVE = ["EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"] as const;
const SLOT_STYLE: Record<SlotState, { tone: "green" | "slate" | "amber" | "red"; label: string }> = {
  done: { tone: "green", label: "Sent" }, waiting: { tone: "slate", label: "Not yet due" }, due_soon: { tone: "amber", label: "Due soon" }, overdue: { tone: "red", label: "Overdue" },
};
const KINDS: { kind: ReportKind; title: string; verb: string }[] = [{ kind: "MORNING", title: "Morning update", verb: "morning update" }, { kind: "EVENING", title: "Evening report", verb: "evening report" }];

/** The last `n` working days (Mon–Sat, IST) before today, as "YYYY-MM-DD". */
function pastWorkingDays(n: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = 1; out.length < n && i < 14; i++) {
    const d = istParts(new Date(now.getTime() - i * 86400000)).date;
    if (new Date(d + "T00:00:00Z").getUTCDay() !== 0) out.push(d);
  }
  return out;
}

export default async function SiteReportsPage() {
  const c = await requirePerm("site_reports:view");
  await maybeRunReminders(c.companyId); // chases missing reports and late items; safe to repeat
  const now = new Date();
  const today = reportDay(now);
  const t = await reportTimes(c.companyId);
  const canSend = c.can("site_reports:create");
  const fieldRole = c.role === "SITE_SUPERVISOR" || c.role === "SITE_ENGINEER";

  const projects = await db.project.findMany({
    where: { ...projectScope(c), status: { in: [...LIVE] } },
    select: { id: true, code: true, name: true, outstation: true, siteAddress: true, projectManagerId: true, supervisorId: true },
    orderBy: { code: "asc" },
  });
  const ids = projects.map((p) => p.id);
  const days = pastWorkingDays(6, now);
  const since = calendarDay(days[days.length - 1] ?? istParts(now).date);
  const reports = await db.dailyReport.findMany({ where: { companyId: c.companyId, projectId: { in: ids }, reportDate: { gte: since } }, orderBy: { submittedAt: "desc" } });
  const todays = new Map(reports.filter((r) => +r.reportDate === +today).map((r) => [`${r.projectId}:${r.kind}`, r]));
  const people = await db.user.findMany({ where: { id: { in: [...new Set(reports.map((r) => r.submittedById))] } }, select: { id: true, name: true } });
  const who = new Map(people.map((u) => [u.id, u.name]));
  const byId = new Map(projects.map((p) => [p.id, p]));

  // 7-day (6 working days) compliance per site
  const rows = projects.map((p) => {
    const mine = reports.filter((r) => r.projectId === p.id);
    const expected = days.length * 2;
    const sent = days.reduce((n, d) => n + (["MORNING", "EVENING"] as const).filter((k) => mine.some((r) => r.reportDate.toISOString().slice(0, 10) === d && r.kind === k)).length, 0);
    const onTime = mine.filter((r) => days.includes(r.reportDate.toISOString().slice(0, 10)) && r.onTime).length;
    return { p, expected, sent, onTime, missing: expected - sent };
  });
  const overall = rows.reduce((a, r) => ({ e: a.e + r.expected, s: a.s + r.sent, o: a.o + r.onTime }), { e: 0, s: 0, o: 0 });
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);

  return (
    <div>
      <PageHeader
        title="Daily site reports"
        subtitle={`Today, ${formatDate(now)} · every live site sends a morning update and an evening report with photos.`}
      />

      {projects.length === 0 ? (
        <EmptyState title="No live sites yet" hint="Reports appear here once a project reaches the Execution stage and has a supervisor assigned." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">{p.code}{p.siteAddress ? ` · ${p.siteAddress}` : ""}</p>
                  </div>
                  {p.outstation && <Badge tone="purple">Outstation</Badge>}
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {KINDS.map(({ kind, title, verb }) => {
                  const r = todays.get(`${p.id}:${kind}`);
                  const st = slotState(kind, p.outstation, !!r, now, t);
                  const s = SLOT_STYLE[st];
                  const canAct = canSend && (c.can("site_reports:edit") || fieldRole || p.projectManagerId === c.userId || p.supervisorId === c.userId);
                  return (
                    <div key={kind} className="px-5 py-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{title}</p>
                          <p className="text-xs text-slate-500">due {dueLabel(kind, p.outstation, t)}</p>
                        </div>
                        <Badge tone={s.tone}>{r && !r.onTime ? "Sent late" : s.label}</Badge>
                      </div>
                      {r ? (
                        <div className="mt-2 space-y-1 text-xs text-slate-600">
                          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{r.manpower} on site</span>
                            {r.photoIds.length > 0 && <span className="inline-flex items-center gap-1"><Camera className="h-3.5 w-3.5" />{r.photoIds.length} photos</span>}
                            {r.progressPct !== null && <span>{r.progressPct}% done</span>}
                            <span>by {who.get(r.submittedById) ?? "—"}</span>
                          </p>
                          {r.materialStatus !== "OK" && <Badge tone={r.materialStatus === "WORK_STOPPED" ? "red" : "amber"}>{MATERIAL_STATUS_LABEL[r.materialStatus]}</Badge>}
                          <p><Link href={`/site-reports/${r.id}`} className="font-medium text-brand-700 hover:underline">View report</Link></p>
                        </div>
                      ) : null}
                      {canAct && (
                        <Button asChild size="lg" variant={r ? "secondary" : st === "overdue" ? "danger" : "primary"} className="mt-3 h-12 w-full">
                          <Link href={`/site-reports/new?project=${p.id}&kind=${kind}`}>{r ? `Update ${verb}` : `Send ${verb}`}</Link>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {!fieldRole && rows.length > 0 && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Reporting discipline – last {days.length} working days</CardTitle>
            <div className="flex gap-2 text-xs">
              <Badge tone={pct(overall.s, overall.e) >= 90 ? "green" : "amber"}>{pct(overall.s, overall.e)}% sent</Badge>
              <Badge tone={pct(overall.o, overall.e) >= 90 ? "green" : "amber"}>{pct(overall.o, overall.e)}% on time</Badge>
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-2.5">Site</th><th className="px-3 py-2.5">Sent</th><th className="px-3 py-2.5">On time</th><th className="px-3 py-2.5">Missing</th><th className="px-3 py-2.5">Compliance</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ p, expected, sent, onTime, missing }) => {
                  const pc = pct(sent, expected);
                  return (
                    <tr key={p.id}>
                      <td className="px-5 py-3"><p className="font-medium text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.code}</p></td>
                      <td className="px-3 py-3">{sent}/{expected}</td>
                      <td className="px-3 py-3">{onTime}</td>
                      <td className={cn("px-3 py-3 font-medium", missing > 0 ? "text-red-600" : "text-emerald-600")}>{missing}</td>
                      <td className="px-3 py-3"><Badge tone={pc >= 90 ? "green" : pc >= 70 ? "amber" : "red"}>{pc}%</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {reports.length > 0 && (
        <Card className="mt-8">
          <CardHeader><CardTitle>Recent reports</CardTitle></CardHeader>
          <ul className="divide-y divide-slate-100">
            {reports.slice(0, 15).map((r) => (
              <li key={r.id}>
                <Link href={`/site-reports/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{byId.get(r.projectId)?.name} · {r.kind === "MORNING" ? "Morning update" : "Evening report"}</span>
                    <span className="text-xs text-slate-500">{formatDate(r.reportDate)} · {who.get(r.submittedById) ?? "—"} · {r.manpower} on site</span>
                  </span>
                  <span className="flex gap-2">{!r.onTime && <Badge tone="amber">Late</Badge>}{r.materialStatus !== "OK" && <Badge tone="red">Material</Badge>}{r.issues && <Badge tone="amber">Issue</Badge>}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
