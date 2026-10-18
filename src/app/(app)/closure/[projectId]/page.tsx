import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Circle, FileDown } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { loadClosure, CLOSURE_DEADLINE_DAYS } from "@/lib/closure";
import { cn, formatDateTime } from "@/lib/utils";
import { PageHeader, Progress, Alert } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/components/forms/action-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { approveClosure, markClosureItem, reopenClosureItem, saveLessons, startClosure, submitClosureReport } from "../actions";

export const metadata = { title: "Project closure" };

export default async function ClosureDetail({ params }: { params: Promise<{ projectId: string }> }) {
  const c = await requirePerm("closure:view");
  const { projectId } = await params;
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) } });
  if (!p) notFound();
  const v = await loadClosure(c.companyId, projectId);
  const edit = c.can("closure:edit");
  const approve = c.can("closure:approve");

  if (!v) {
    return (
      <div>
        <PageHeader back={{ href: "/closure", label: "Project closure" }} title={`${p.code} · ${p.name}`} subtitle="No closure checklist yet." />
        {c.can("closure:create") && ["SNAGGING", "HANDOVER", "COMPLETED"].includes(p.status) ? <ActionButton action={startClosure.bind(null, projectId)}>Start the closure checklist</ActionButton> : <Alert>The checklist starts when the project reaches snagging, handover or completion.</Alert>}
      </div>
    );
  }
  const open = v.closure.status === "OPEN";
  const days = Math.floor((Date.now() - v.closure.startedAt.getTime()) / 86400000);
  const late = open && days > CLOSURE_DEADLINE_DAYS;
  const people = await db.user.findMany({ where: { id: { in: v.items.map((i) => i.doneById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const who = new Map(people.map((u) => [u.id, u.name]));

  return (
    <div>
      <PageHeader
        back={{ href: "/closure", label: "Project closure" }}
        title={`${p.code} · ${p.name}`}
        subtitle={`Checklist started ${formatDateTime(v.closure.startedAt)} · ${CLOSURE_DEADLINE_DAYS}-day limit`}
        actions={<>
          <Badge tone={v.closure.status === "CLOSED" ? "green" : v.closure.status === "SUBMITTED" ? "blue" : "amber"}>{v.closure.status === "CLOSED" ? "Closed" : v.closure.status === "SUBMITTED" ? "With directors" : "In progress"}</Badge>
          {c.can("margins:view") && <Button asChild variant="secondary" size="sm"><a href={`/closure/${projectId}/report`} target="_blank" rel="noreferrer"><FileDown className="h-4 w-4" /> Closure report (PDF)</a></Button>}
        </>}
      />
      {late && <div className="mb-4"><Alert tone="bad">This checklist is {days - CLOSURE_DEADLINE_DAYS} day(s) past the {CLOSURE_DEADLINE_DAYS}-day limit. The directors have been told.</Alert></div>}
      <Card className="mb-5 p-5">
        <div className="flex items-center gap-3"><Progress value={(v.done / v.total) * 100} className="flex-1" /><span className="tabular text-sm font-semibold">{v.done} of {v.total} done</span></div>
      </Card>

      <Card>
        <CardHeader><CardTitle>Checklist</CardTitle></CardHeader>
        <ul className="divide-y divide-slate-100">
          {v.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              {i.effectiveDone ? <Check className="h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="h-5 w-5 shrink-0 text-slate-300" />}
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", i.effectiveDone ? "text-slate-900" : "text-slate-700")}>{i.title} {i.auto && <Badge tone="blue" className="ml-1">Automatic</Badge>}</p>
                <p className="text-xs text-slate-500">{i.auto ? i.detail : i.effectiveDone ? `Done ${formatDateTime(i.doneAt)}${i.doneById ? ` by ${who.get(i.doneById) ?? "—"}` : ""}${i.note ? ` · ${i.note}` : ""}` : i.hint}{i.docId && <> · <a className="text-brand-700 hover:underline" href={`/documents/${i.docId}/download`}>view document</a></>}</p>
              </div>
              {edit && open && !i.auto && (i.effectiveDone
                ? <ActionButton size="sm" variant="ghost" action={reopenClosureItem.bind(null, i.id)}>Reopen</ActionButton>
                : <FormDialog title={i.title} description={i.docRequired ? "Attach the document to mark this done." : "Confirm to mark this done. A document is optional."} trigger={<Button size="sm">Mark done</Button>}
                    fields={[{ name: "file", label: i.docRequired ? "Document (photo / PDF / scan)" : "Document (optional)", type: "file", required: i.docRequired, full: true }, { name: "note", label: "Note (optional)", type: "textarea", full: true }]}
                    action={markClosureItem.bind(null, i.id)} submitLabel="Mark done" />)}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Lessons learned (Project Director)</CardTitle>
          {approve && v.closure.status !== "CLOSED" && <FormDialog title="Lessons learned" description="What went well, what went wrong, what to do differently next time." wide trigger={<Button size="sm" variant="secondary">{v.closure.lessonsLearned ? "Edit" : "Write"}</Button>} fields={[{ name: "lessons", label: "Lessons learned", type: "textarea", required: true, full: true, defaultValue: v.closure.lessonsLearned ?? "" }]} action={saveLessons.bind(null, projectId)} />}
        </CardHeader>
        <CardBody><p className="whitespace-pre-wrap text-sm text-slate-700">{v.closure.lessonsLearned || "Not written yet."}</p></CardBody>
      </Card>

      <div className="mt-5 flex flex-wrap gap-2">
        {edit && open && <ActionButton disabled={v.missing.length > 0} action={submitClosureReport.bind(null, projectId)} confirm={{ title: "Send the closure report to the directors?", body: "All 15 items are complete. The report goes to the Commercial Director and Managing Director.", confirmLabel: "Send report" }}>Submit closure report</ActionButton>}
        {approve && v.closure.status === "SUBMITTED" && <ActionButton variant="success" action={approveClosure.bind(null, projectId)} confirm={{ title: "Close this project?", body: "The project is marked completed. This is the final sign-off.", confirmLabel: "Close project" }}>Approve and close project</ActionButton>}
        {edit && open && v.missing.length > 0 && <p className="self-center text-sm text-slate-500">{v.missing.length} item(s) left before the report can be sent.</p>}
      </div>
      <p className="mt-6 text-xs text-slate-500"><Link className="text-brand-700 hover:underline" href={`/projects/${projectId}`}>Open project</Link></p>
    </div>
  );
}
