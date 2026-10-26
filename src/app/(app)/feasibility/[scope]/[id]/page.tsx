import Link from "next/link";
import { notFound } from "next/navigation";
import type { ChecklistItem } from "@prisma/client";
import { requirePerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { projectScope } from "@/lib/scope";
import { userOptions } from "@/lib/lookups";
import { feasibilityForProject, feasibilityForQuotation, isOpen } from "@/lib/readiness";
import { cn, formatDate, formatDateTime, startOfDay, toDateInput } from "@/lib/utils";
import { PageHeader, Alert, StatCard } from "@/components/ui/page";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, Th, Tr, Td } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/forms/form-dialog";
import { decideFeasibility, updateChecklistItem } from "../../actions";

export const metadata = { title: "Readiness" };

const STATUS = [
  { value: "PENDING", label: "Not confirmed yet" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "AT_RISK", label: "At risk" },
  { value: "NOT_NEEDED", label: "Not needed for this job" },
];
const DECISION = { PENDING: "Not decided", ACCEPT: "Accepted", ACCEPT_WITH_CONDITIONS: "Accepted with conditions", RENEGOTIATE_OR_DECLINE: "Renegotiate or decline" } as const;

export default async function ReadinessPage({ params }: { params: Promise<{ scope: string; id: string }> }) {
  const { scope, id } = await params;
  const c = await requirePerm("feasibility:view");
  if (scope !== "project" && scope !== "quotation") notFound();
  let title = "";
  let back = { href: "/projects", label: "Projects" };
  let f;
  if (scope === "project") {
    const p = await db.project.findFirst({ where: { id, ...projectScope(c) }, select: { id: true, code: true, name: true } });
    if (!p) notFound();
    f = await feasibilityForProject(c.companyId, p.id);
    title = `${p.code} · ${p.name}`;
    back = { href: `/projects/${p.id}`, label: title };
  } else {
    if (!c.can("quotations:view")) notFound();
    const q = await db.quotation.findFirst({ where: { id, companyId: c.companyId, deletedAt: null }, select: { id: true, number: true, title: true } });
    if (!q) notFound();
    f = await feasibilityForQuotation(c.companyId, q.id);
    title = `${q.number}${q.title ? ` · ${q.title}` : ""}`;
    back = { href: `/sales/quotations/${q.id}`, label: title };
  }
  const team = await userOptions(c.companyId);
  const names = new Map(team.map((t) => [t.value, t.label]));
  const today = startOfDay();
  const canEdit = c.can("feasibility:edit");
  const canDecide = c.can("feasibility:approve");
  const check = f.items.filter((i) => i.kind === "FEASIBILITY");
  const launch = f.items.filter((i) => i.kind === "LAUNCH");
  const openCheck = check.filter(isOpen);
  const late = launch.filter((i) => isOpen(i) && i.dueDate && i.dueDate < today);

  const table = (items: ChecklistItem[], withDue: boolean) => (
    <Table>
      <THead><tr><Th>Question</Th><Th>Status</Th><Th>Owner</Th>{withDue && <Th>Due</Th>}<Th>Who confirmed, and how</Th><Th /></tr></THead>
      <tbody>
        {items.map((i) => {
          const overdue = withDue && isOpen(i) && i.dueDate && i.dueDate < today;
          return (
            <Tr key={i.id}>
              <Td className="max-w-md"><p className="font-medium text-slate-900">{i.label}</p><p className="text-xs text-slate-500">{i.question}</p></Td>
              <Td><Badge tone={i.status === "CONFIRMED" ? "green" : i.status === "AT_RISK" ? "amber" : i.status === "NOT_NEEDED" ? "slate" : "blue"}>{STATUS.find((s) => s.value === i.status)?.label}</Badge></Td>
              <Td className="text-sm">{i.ownerId ? names.get(i.ownerId) ?? "—" : <span className="text-slate-400">no owner</span>}</Td>
              {withDue && <Td className={cn("whitespace-nowrap text-sm", overdue && "font-medium text-red-600")}>{formatDate(i.dueDate)}{overdue && " (late)"}</Td>}
              <Td className="max-w-xs text-xs text-slate-600">{i.evidence ?? "—"}{i.confirmedAt && <span className="block text-slate-400">{formatDateTime(i.confirmedAt)}{i.confirmedById ? ` · ${names.get(i.confirmedById) ?? ""}` : ""}</span>}</Td>
              <Td className="text-right">
                {canEdit && (
                  <FormDialog
                    title={i.label}
                    description={i.question ?? undefined}
                    trigger={<Button size="sm" variant="secondary">Update</Button>}
                    fields={[
                      { name: "status", label: "Status", type: "select", options: STATUS, required: true, defaultValue: i.status },
                      { name: "ownerId", label: "Owner", type: "select", options: team, defaultValue: i.ownerId },
                      { name: "dueDate", label: "Due date", type: "date", defaultValue: toDateInput(i.dueDate) },
                      { name: "evidence", label: "Who confirmed it, and how?", type: "textarea", full: true, defaultValue: i.evidence, hint: "Needed to mark it confirmed: a person and when (for example: Ramesh, vendor, by phone, 27 Oct), or the document." },
                    ]}
                    action={updateChecklistItem.bind(null, i.id)}
                  />
                )}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader
        back={back}
        title={scope === "project" ? "Readiness" : "Feasibility check"}
        subtitle={`${title} · Can DSC really do this job? Check people, vendors, materials, factory, schedule and cash before committing, then get ready in the first three days.`}
        actions={canDecide && (
          <FormDialog
            title="Decision"
            description="Accept, accept with conditions, or renegotiate or decline."
            trigger={<Button>Record decision</Button>}
            fields={[
              { name: "decision", label: "Decision", type: "select", required: true, options: [{ value: "ACCEPT", label: "Accept" }, { value: "ACCEPT_WITH_CONDITIONS", label: "Accept with conditions" }, { value: "RENEGOTIATE_OR_DECLINE", label: "Renegotiate or decline" }], defaultValue: f.decision === "PENDING" ? null : f.decision },
              { name: "note", label: "Conditions, or what must change", type: "textarea", full: true, defaultValue: f.note },
              ...(openCheck.length ? [{ name: "exceptionNote", label: `${openCheck.length} question(s) are still open: why go ahead, and who accepts the risk?`, type: "textarea" as const, full: true, hint: "Only needed when accepting with open questions. You are recorded as the person accepting it." }, { name: "resolveBy", label: "Close the open questions by", type: "date" as const }] : []),
            ]}
            action={decideFeasibility.bind(null, f.id)}
            submitLabel="Record decision"
          />
        )}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Decision" value={DECISION[f.decision]} tone={f.decision === "ACCEPT" ? "good" : f.decision === "RENEGOTIATE_OR_DECLINE" ? "bad" : f.decision === "PENDING" ? "default" : "warn"} sub={f.decidedAt ? `${formatDateTime(f.decidedAt)}${f.decidedById ? ` · ${names.get(f.decidedById) ?? ""}` : ""}` : undefined} />
        <StatCard label="Feasibility questions confirmed" value={`${check.length - openCheck.length} of ${check.length}`} tone={openCheck.length ? "warn" : "good"} />
        {scope === "project" && <StatCard label="Launch steps done" value={`${launch.filter((i) => !isOpen(i)).length} of ${launch.length}`} tone={late.length ? "bad" : "default"} sub={late.length ? `${late.length} late` : undefined} />}
      </div>

      {f.exceptionNote && (
        <div className="mb-5"><Alert tone="warn"><b>Accepted as an exception</b> by {f.exceptionApproverId ? names.get(f.exceptionApproverId) ?? "—" : "—"}: {f.exceptionNote}{f.resolveBy && <> The open questions must be closed by <b>{formatDate(f.resolveBy)}</b>; an action was raised for each.</>}</Alert></div>
      )}
      {f.note && f.decision !== "PENDING" && <p className="mb-5 text-sm text-slate-600"><b>Note:</b> {f.note}</p>}

      <Card>
        <CardHeader><CardTitle>Capacity check before accepting the job</CardTitle></CardHeader>
        {table(check, false)}
      </Card>

      {scope === "project" && (
        <Card className="mt-5">
          <CardHeader><CardTitle>First three days (Day 0 is the day the job was handed over)</CardTitle></CardHeader>
          <CardBody className="pb-2 text-xs text-slate-500">Out-of-city jobs get extra days. Each step has an owner and a date; when a date passes without confirmation the owner, the project manager and then the directors are told.</CardBody>
          {table(launch, true)}
        </Card>
      )}
      {scope === "quotation" && <p className="mt-4 text-sm text-slate-500">Once the quotation becomes a project, this check carries over to it and the launch checklist is added. <Link href="/sales/quotations" className="text-brand-700 hover:underline">Back to quotations</Link></p>}
    </>
  );
}
