import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { projectSchedule, type ScheduleDay } from "@/lib/project-schedule";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, StatCard, Alert } from "@/components/ui/page";
import { FormDialog } from "@/components/forms/form-dialog";
import { cn } from "@/lib/utils";
import { importSchedule, pasteSchedule } from "../actions";
import sample from "@/lib/schedule-sample.json";

/** What each column means, shown on screen so a schedule can be typed in Excel the right way without opening the template. */
const MEANING: Record<string, string> = {
  "Sl No": "1, 2, 3 …", Task: "what is to be done (must be filled)", "Area / zone": "where on the site", Trade: "who does it: Carpenter, Electrician…",
  "People needed": "how many people", "Assigned to": "the coordinator in charge (aryan.s@dsc) – can be empty", "Start day": "day 1 = project start",
  "End day": "last day of this work (a week-long job: 5 to 11)", "Planned quantity": "how much work", Unit: "sqft, rft, nos…", "Depends on": "Sl No of the work that must finish first",
  Priority: "Low, Medium, High or Urgent", Details: "anything else",
  Material: "what is needed", Quantity: "how much", "Needed day": "day it must be ON SITE", "For work": "Sl No of the work it is for", Note: "anything else",
};

function TemplateView() {
  const sheet = (title: string, header: string[], rows: (string | number)[][]) => (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full whitespace-nowrap text-xs">
          <thead className="bg-brand-900 text-left text-white"><tr>{header.map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-amber-50 text-[11px] text-amber-900">{header.map((h) => <td key={h} className="whitespace-normal px-2 py-1 align-top">{MEANING[h] ?? ""}</td>)}</tr>
            {rows.map((r, i) => <tr key={i}>{header.map((h, j) => <td key={h} className="px-2 py-1 text-slate-700">{String(r[j] ?? "")}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Make the schedule in Excel with exactly these columns (the yellow row says what goes in each; the rows under it are an example). Work that runs a whole week or month is ONE row: Start day 5, End day 30. It then shows on every one of those days.</p>
      {sheet("Sheet 1: the work", sample.header, sample.rows.slice(0, 3) as (string | number)[][])}
      {sheet("Sheet 2, called Materials: what the work needs", sample.materialsHeader, sample.materials.slice(0, 2) as (string | number)[][])}
    </div>
  );
}

const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The project's day-by-day plan: Day 1 to the last day, and for each day the work running, the people each trade needs and any billing
 * stage. Material is not shown here on purpose: it is in the Materials tab, with its own alerts.
 */
export async function ScheduleTab({ companyId, projectId, hasStart, canUpload, existing }: { companyId: string; projectId: string; hasStart: boolean; canUpload: boolean; existing: { tasks: number; needs: number } }) {
  const s = await projectSchedule(companyId, projectId);
  const addBox = existing.tasks + existing.needs ? [{ name: "addToExisting", label: "Add these to what is already there", type: "checkbox" as const, hint: `This project already has ${existing.tasks} task${existing.tasks === 1 ? "" : "s"} and ${existing.needs} material line${existing.needs === 1 ? "" : "s"}.` }] : [];
  const template = canUpload && (
    <Card>
      <details open={!s.days.length}>
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-slate-900">How the schedule must look (columns)</summary>
        <CardBody className="pt-0"><TemplateView /></CardBody>
      </details>
    </Card>
  );
  const upload = canUpload && (
    <div className="flex flex-wrap items-center gap-2">
      <FormDialog title="Paste from Excel" wide description="In Excel, select the rows WITH the row of column names on top, copy (Ctrl+C), and paste (Ctrl+V) here. Same columns as the template. If any row is wrong, nothing is added and you are told which row." trigger={<Button size="sm" variant="secondary">Paste from Excel</Button>}
        fields={[{ name: "work", label: "The work (sheet 1)", type: "textarea", full: true, placeholder: "Copy from Excel starting with the row: Sl No | Task | Area / zone | Trade | People needed | Assigned to | Start day | End day …" }, { name: "materials", label: "Materials (optional)", type: "textarea", full: true, placeholder: "Copy from Excel starting with the row: Material | Quantity | Unit | Needed day | For work | Note" }, ...addBox]}
        action={pasteSchedule.bind(null, projectId)} submitLabel="Add the schedule" />
      <a href="/projects/schedule-template" download className="text-xs font-medium text-brand-700 hover:underline">Download the schedule template</a>
      <FormDialog title="Upload the schedule" description="One Excel file: the first sheet is the day-by-day work (what, where, which trade, how many people, from which day to which day). A second sheet called Materials lists the material the work needs and the day it must be on site. If any row is wrong, nothing is added and you are told which row." trigger={<Button size="sm">Upload schedule</Button>}
        fields={[{ name: "file", label: "Schedule file (.xlsx or .csv)", type: "file", required: true, full: true, hint: hasStart ? "Use the template. Dates, or day numbers counted from the project start." : "Use the template. This project has no start date yet, so use real dates, or set the start date first to use day numbers." }, ...addBox]}
        action={importSchedule.bind(null, projectId)} submitLabel="Add the schedule" />
    </div>
  );
  if (!s.days.length) return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Schedule</CardTitle>{upload}</CardHeader>
        <EmptyState title="No schedule yet" hint={canUpload ? "Upload the Excel file or paste the rows from Excel. The columns are shown below." : "The directors add the day-by-day plan here. You will see each day's work as soon as it is added."} />
      </Card>
      {template}
    </div>
  );

  const todayIdx = s.days.findIndex((d) => d.isToday);
  const past = s.days.filter((d) => d.isPast), coming = s.days.filter((d) => !d.isPast);
  const lastDay = s.days[s.days.length - 1].dayNo;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Plan length" value={`${lastDay} days`} sub={`${dayLabel(s.days[0].date)} to ${dayLabel(s.days[s.days.length - 1].date)}`} />
        <StatCard label="Today" value={todayIdx >= 0 ? `Day ${s.days[todayIdx].dayNo}` : s.days[0].date > s.today ? "Not started" : "Plan ended"} />
        <StatCard label="Work done" value={`${s.counts.done} of ${s.counts.work}`} tone={s.counts.done === s.counts.work ? "good" : "default"} />
        <StatCard label="Running late" value={String(s.counts.late)} tone={s.counts.late ? "bad" : "good"} />
      </div>
      {template}
      {s.truncated && <Alert tone="warn">The plan is longer than 150 days; only the first 150 days are shown.</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Day-by-day plan</CardTitle>
          {upload}
        </CardHeader>
        <CardBody className="space-y-2 py-3">
          <p className="text-xs text-slate-500">Change a date or mark work done in the <Link href={`/projects/${projectId}?tab=tasks`} className="text-brand-700 hover:underline">Tasks</Link> tab and this plan follows. Material for these days is in the <Link href={`/projects/${projectId}?tab=materials`} className="text-brand-700 hover:underline">Materials</Link> tab.</p>
          {past.length > 0 && (
            <details className="rounded-lg border border-slate-200">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-600">Earlier days (Day {past[0].dayNo} to Day {past[past.length - 1].dayNo}){past.some((d) => d.work.some((w) => w.late)) && <span className="text-red-600"> · some work is still not done</span>}</summary>
              <div className="space-y-2 p-2">{past.map((d) => <DayRow key={d.date.getTime()} d={d} />)}</div>
            </details>
          )}
          {coming.map((d) => <DayRow key={d.date.getTime()} d={d} />)}
        </CardBody>
      </Card>
    </div>
  );
}

function DayRow({ d }: { d: ScheduleDay }) {
  const quiet = d.work.length === 0 && d.milestones.length === 0;
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", d.isToday ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500" : "border-slate-200", quiet && "py-1.5")}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <CalendarDays className="h-4 w-4 self-center text-slate-400" />
        <span className="font-semibold text-slate-900">{d.dayNo >= 1 ? `Day ${d.dayNo}` : "Before day 1"}</span>
        <span className="text-sm text-slate-500">{dayLabel(d.date)}</span>
        {d.isToday && <Badge tone="blue">Today</Badge>}
        {d.isSunday && <Badge tone="slate">Sunday</Badge>}
        {d.people.length > 0 && <span className="ml-auto text-xs text-slate-600">People: {d.people.map((p) => `${p.count} ${p.trade}`).join(", ")}</span>}
      </div>
      {quiet ? <p className="mt-0.5 pl-6 text-xs text-slate-400">No work planned</p> : (
        <ul className="mt-1.5 space-y-1 pl-6">
          {d.work.map((w) => (
            <li key={w.id} className="text-sm">
              <span className={cn("font-medium", w.done ? "text-slate-400 line-through" : "text-slate-800")}>{w.name}</span>
              <span className="text-xs text-slate-500">{w.zone && ` · ${w.zone}`}{w.trade && ` · ${w.people ?? ""} ${w.trade}`.replace("  ", " ")}{w.of > 1 && ` · day ${w.day} of ${w.of}`}</span>
              {w.done ? <Badge tone="green" className="ml-2">Done</Badge> : w.late ? <Badge tone="red" className="ml-2">Late</Badge> : w.status === "BLOCKED" ? <Badge tone="red" className="ml-2">Blocked</Badge> : w.status === "IN_PROGRESS" ? <span className="ml-2 text-xs text-brand-700">{w.progress}%</span> : null}
            </li>
          ))}
          {d.milestones.map((m) => <li key={m.id} className="text-sm font-medium text-amber-800">◆ {m.name}{m.done && " (done)"}</li>)}
        </ul>
      )}
    </div>
  );
}
