import { redirect } from "next/navigation";
import { CheckCircle2, Hammer, MapPin, PackagePlus, TriangleAlert } from "lucide-react";
import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { calendarDay, formatDate, formatDateTime, cn } from "@/lib/utils";
import { ActionButton } from "@/components/forms/action-button";
import { FormDialog } from "@/components/forms/form-dialog";
import { UNIT_OPTS } from "@/lib/enums";
import { checkIn } from "@/app/(app)/workforce/actions";
import { workerReportIssue, workerRequestMaterial, workerTaskStatus } from "./actions";
import { CheckInButton } from "./check-in-button";

export const metadata = { title: "My Day" };

export default async function WorkerHome() {
  const c = await requireCtx();
  if (c.role !== "WORKER" || !c.workerId) redirect("/");
  const worker = await db.worker.findUniqueOrThrow({ where: { id: c.workerId } });
  const [project, today, tasks] = await Promise.all([
    worker.currentProjectId ? db.project.findUnique({ where: { id: worker.currentProjectId }, select: { id: true, name: true, siteAddress: true, supervisorId: true } }) : null,
    db.attendance.findUnique({ where: { workerId_date: { workerId: c.workerId, date: calendarDay() } } }),
    db.projectTask.findMany({ where: { companyId: c.companyId, status: { not: "COMPLETED" }, OR: [{ workerId: c.workerId }, { assignedToId: c.userId }] }, include: { project: { select: { name: true } } }, orderBy: [{ dueDate: "asc" }], take: 10 }),
  ]);
  const present = today && today.status !== "ABSENT" && today.status !== "LEAVE";
  const supervisor = project?.supervisorId ? await db.user.findUnique({ where: { id: project.supervisorId }, select: { name: true, phone: true } }) : null;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Today&apos;s site</p>
        {project ? (
          <>
            <p className="mt-1 text-xl font-bold text-slate-900">{project.name}</p>
            {project.siteAddress && <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{project.siteAddress}</p>}
            {supervisor && <p className="mt-2 text-sm text-slate-600">Supervisor: <b className="text-slate-900">{supervisor.name}</b>{supervisor.phone && <> · <a href={`tel:${supervisor.phone}`} className="font-medium text-brand-700">Call</a></>}</p>}
          </>
        ) : <p className="mt-1 text-base text-slate-700">No site assigned yet. Please ask your supervisor.</p>}
      </section>

      {present ? (
        <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-5 text-emerald-900 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-10 w-10 shrink-0 text-emerald-600" />
          <div><p className="text-xl font-bold">You&apos;re marked present</p><p className="text-sm">{today!.status === "HALF_DAY" ? "Half day" : "Full day"} · {formatDateTime(today!.createdAt)}</p></div>
        </div>
      ) : project ? <CheckInButton action={checkIn.bind(null, project.id)} /> : null}

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-slate-900"><Hammer className="h-5 w-5" /> My tasks</h2>
        {tasks.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">No tasks right now. 👍</p> : (
          <ul className="space-y-3">
            {tasks.map((t) => (
              <li key={t.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-lg font-semibold leading-snug text-slate-900">{t.name}</p>
                <p className="mt-0.5 text-sm text-slate-500">{t.project.name}{t.dueDate ? ` · by ${formatDate(t.dueDate)}` : ""}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {t.status === "TODO" || t.status === "BLOCKED" ? (
                    <ActionButton size="lg" className="col-span-2 h-14 text-lg" action={workerTaskStatus.bind(null, t.id, "IN_PROGRESS")}>▶ Start</ActionButton>
                  ) : (
                    <>
                      <ActionButton size="lg" variant="success" className="h-14 text-lg" action={workerTaskStatus.bind(null, t.id, "COMPLETED")}>✓ Done</ActionButton>
                      <ActionButton size="lg" variant="secondary" className={cn("h-14 text-lg")} action={workerTaskStatus.bind(null, t.id, "BLOCKED")}>✋ Stuck</ActionButton>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <FormDialog title="Request material" description="Tell us what you need on site. Your project manager will approve it." trigger={<button className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold text-slate-800 shadow-sm ring-1 ring-slate-200 active:bg-slate-50"><PackagePlus className="h-8 w-8 text-brand-700" />Need material</button>}
          fields={[{ name: "item", label: "What do you need?", required: true, full: true, placeholder: "e.g. 18mm plywood" }, { name: "quantity", label: "How many?", type: "number", required: true }, { name: "unit", label: "Unit", type: "select", options: UNIT_OPTS, defaultValue: "nos" }, { name: "note", label: "Anything else?", type: "textarea" }]}
          action={workerRequestMaterial} submitLabel="Send request" />
        <FormDialog title="Report a problem" description="Your supervisor and project manager will be told right away." trigger={<button className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold text-slate-800 shadow-sm ring-1 ring-slate-200 active:bg-slate-50"><TriangleAlert className="h-8 w-8 text-amber-600" />Report problem</button>}
          fields={[{ name: "issue", label: "What is the problem?", type: "textarea", required: true, full: true }]} action={workerReportIssue} submitLabel="Send" />
      </section>
    </div>
  );
}
