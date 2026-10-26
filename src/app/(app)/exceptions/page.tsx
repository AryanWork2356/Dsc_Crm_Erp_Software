import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { exceptionReport, STALE_DAYS } from "@/lib/exceptions";
import { cn, formatDateTime } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Exceptions" };

export default async function ExceptionsPage() {
  const c = await requirePerm("exceptions:view");
  const r = await exceptionReport(c);
  return (
    <>
      <PageHeader title="Exceptions" subtitle="Only what needs a decision or a push today. Every line opens the record behind it. Nothing here is sample data." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active projects" value={r.activeProjects} href="/projects" />
        <StatCard label="Projects with a problem" value={r.totals.projectsWithProblems} tone={r.totals.projectsWithProblems ? "bad" : "good"} />
        <StatCard label="Items to look at" value={r.totals.exceptions} tone={r.totals.exceptions ? "warn" : "good"} />
        <StatCard label="Checked" value={formatDateTime(r.generatedAt)} />
      </div>

      {r.sections.length === 0 ? (
        <Card><CardBody className="flex items-center gap-3 py-8 text-emerald-800"><CheckCircle2 className="h-6 w-6" /> Nothing is late or missing right now.</CardBody></Card>
      ) : (
        <div className="space-y-5">
          {r.sections.map((s) => (
            <Card key={s.key}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><AlertTriangle className={cn("h-4 w-4", s.tone === "bad" ? "text-red-500" : "text-amber-500")} /> {s.title}</CardTitle>
                <Badge tone={s.tone === "bad" ? "red" : "amber"}>{s.rows.length}</Badge>
              </CardHeader>
              <p className="px-5 pb-2 text-xs text-slate-500">{s.hint}</p>
              <ul className="divide-y divide-slate-100">
                {s.rows.map((row) => (
                  <li key={`${s.key}:${row.id}`}>
                    <Link href={row.link} className="flex flex-wrap items-center gap-x-3 px-5 py-2.5 text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-900">{row.title}</span>
                      {row.detail && <span className="text-slate-500">{row.detail}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader><CardTitle>How these are counted</CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm text-slate-600">
          <p><b>Active project</b>: status Planning to Handover. <b>No budget</b>: budget is 0 and no BOQ has an estimated cost. <b>No daily report</b>: a project in execution, quality check or snagging with no report in the last {STALE_DAYS} days.</p>
          <p><b>Moved date</b>: the planned completion (or a task due date) is later than the first date ever committed; that first date never changes and every move has a written reason.</p>
          <p><b>Late milestone</b>: past its date and not marked done. <b>Past a time limit</b>: from the Time Limits board. Money lists appear only for people allowed to see finance.</p>
        </CardBody>
      </Card>
    </>
  );
}
