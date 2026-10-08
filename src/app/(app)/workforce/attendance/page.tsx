import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { calendarDay, formatDate, humanize } from "@/lib/utils";
import { PageHeader, TabLinks, EmptyState, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { AttendanceSheet } from "./attendance-sheet";
import { markEmployeeAttendance, markWorkerAttendance } from "../actions";

export const metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ tab?: string; date?: string; project?: string }> }) {
  const c = await requirePerm("attendance:view");
  const sp = await searchParams;
  const tab = sp.tab === "staff" && c.can("employees:view") ? "staff" : sp.tab === "sites" ? "sites" : "workers";
  const todayStr = calendarDay().toISOString().slice(0, 10);
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayStr;
  const date = calendarDay(dateStr);
  const canMark = c.can("attendance:create");

  const projects = await db.project.findMany({ where: { ...projectScope(c), status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const projectId = sp.project && projects.some((p) => p.id === sp.project) ? sp.project : projects[0]?.id;

  const qs = (o: Record<string, string | undefined>) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries({ tab, date: dateStr, project: projectId, ...o })) if (v) q.set(k, v); return `/workforce/attendance?${q}`; };

  const header = (
    <form method="get" className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
      <input type="hidden" name="tab" value={tab} />
      <label className="space-y-1 text-xs font-medium text-slate-600">Date<Input type="date" name="date" defaultValue={dateStr} max={todayStr} className="w-44" /></label>
      {tab === "workers" && (
        <label className="space-y-1 text-xs font-medium text-slate-600">Site<Select name="project" defaultValue={projectId} className="min-w-[240px]">{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</Select></label>
      )}
      <Button type="submit" variant="secondary">Show</Button>
    </form>
  );

  let body: React.ReactNode;
  if (tab === "workers") {
    if (!projectId) body = <EmptyState title="No active projects" hint="Attendance is marked per project site." />;
    else {
      const [workers, marks] = await Promise.all([
        db.worker.findMany({ where: { companyId: c.companyId, deletedAt: null, isActive: true, OR: [{ currentProjectId: projectId }, { attendance: { some: { projectId, date } } }] }, orderBy: { name: "asc" }, include: { contractor: { select: { name: true } } } }),
        db.attendance.findMany({ where: { companyId: c.companyId, date, workerId: { not: null } } }),
      ]);
      const elsewhere = new Set(marks.filter((m) => m.projectId !== projectId).map((m) => m.workerId));
      const mine = new Map(marks.filter((m) => m.projectId === projectId).map((m) => [m.workerId, m]));
      body = (
        <AttendanceSheet
          key={`${projectId}-${dateStr}`} date={dateStr} projectId={projectId} idField="workerId" action={markWorkerAttendance} readOnly={!canMark}
          people={workers.filter((w) => !elsewhere.has(w.id)).map((w) => ({ id: w.id, name: w.name, sub: `${humanize(w.trade)}${w.contractor ? ` · ${w.contractor.name}` : ""}`, status: mine.get(w.id)?.status ?? "", ot: Number(mine.get(w.id)?.overtimeHrs ?? 0) }))}
        />
      );
    }
  } else if (tab === "staff") {
    const [emps, marks] = await Promise.all([
      db.employee.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { not: "EXITED" } }, orderBy: { name: "asc" } }),
      db.attendance.findMany({ where: { companyId: c.companyId, date, employeeId: { not: null } } }),
    ]);
    const m = new Map(marks.map((x) => [x.employeeId, x]));
    body = <AttendanceSheet key={`staff-${dateStr}`} date={dateStr} idField="employeeId" action={markEmployeeAttendance} readOnly={!canMark} people={emps.map((e) => ({ id: e.id, name: e.name, sub: [e.designation, e.department].filter(Boolean).join(" · "), status: m.get(e.id)?.status ?? "", ot: Number(m.get(e.id)?.overtimeHrs ?? 0) }))} />;
  } else {
    const marks = await db.attendance.findMany({ where: { companyId: c.companyId, date, workerId: { not: null }, projectId: { in: projects.map((p) => p.id) } }, include: { worker: { select: { name: true, trade: true } } } });
    const present = marks.filter((m) => ["PRESENT", "OVERTIME", "HALF_DAY"].includes(m.status));
    body = (
      <div className="space-y-4 p-5">
        {projects.map((p) => {
          const here = present.filter((m) => m.projectId === p.id);
          const absent = marks.filter((m) => m.projectId === p.id && m.status === "ABSENT");
          return (
            <div key={p.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between"><Link href={`/workforce/attendance?project=${p.id}&date=${dateStr}`} className="font-medium text-slate-900 hover:text-brand-700">{p.code} · {p.name}</Link><span className="text-sm text-slate-600"><b className="text-emerald-700">{here.length}</b> present{absent.length ? <> · <b className="text-red-600">{absent.length}</b> absent</> : null}</span></div>
              {here.length > 0 ? <p className="mt-2 text-sm text-slate-600">{here.map((m) => `${m.worker?.name} (${humanize(m.worker?.trade ?? "")})`).join(", ")}</p> : <p className="mt-2 text-sm text-slate-400">No one marked yet.</p>}
            </div>
          );
        })}
      </div>
    );
  }

  const totalPresent = await db.attendance.count({ where: { companyId: c.companyId, date, workerId: { not: null }, status: { in: ["PRESENT", "OVERTIME", "HALF_DAY"] } } });
  const label = dateStr === todayStr ? "today" : formatDate(date);

  return (
    <>
      <PageHeader title="Attendance" subtitle="Who is on which site. Tap to mark; wages are calculated from this." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3"><StatCard label={`Workers present ${label}`} value={totalPresent} tone="good" /></div>
      <TabLinks current={tab} tabs={[{ key: "workers", label: "Site workers", href: qs({ tab: "workers" }) }, { key: "sites", label: "Who is where", href: qs({ tab: "sites" }) }, ...(c.can("employees:view") ? [{ key: "staff", label: "Office & site staff", href: qs({ tab: "staff" }) }] : [])]} />
      <Card>
        <CardHeader><CardTitle>{tab === "workers" ? "Mark site attendance" : tab === "staff" ? "Staff attendance" : `Sites ${label}`}</CardTitle></CardHeader>
        {header}
        {body}
      </Card>
    </>
  );
}
