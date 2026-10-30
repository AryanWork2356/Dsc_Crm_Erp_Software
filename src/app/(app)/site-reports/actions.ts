"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReportKind, SiteMaterialStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { raiseAction, resolveActionsFor } from "@/lib/action-items";
import { coordinatorFor, shortDaySeverity } from "@/lib/resources";
import { recalcProgress } from "@/lib/project-progress";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { notifyRoles, notifyUsers } from "@/lib/notify";
import { projectScope } from "@/lib/scope";
import { putFile, deleteFile, validateUpload, UploadError } from "@/lib/storage";
import { formToObject, zOptStr } from "@/lib/form";
import { isOnTime, reportDay } from "@/lib/site-reports";
import { reportTimes } from "@/lib/site-report-reminders";

const MAX_PHOTOS = 10;
const IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];

const schema = z.object({
  projectId: z.string().min(1, "Choose a site"),
  kind: z.nativeEnum(ReportKind),
  manpower: z.coerce.number({ message: "Enter how many people are on site" }).int().min(0, "Cannot be negative").max(2000),
  progressPct: z.coerce.number().int().min(0).max(100).optional(),
  workDone: zOptStr,
  planNext: zOptStr,
  materialStatus: z.nativeEnum(SiteMaterialStatus).default("OK"),
  issues: zOptStr,
});

/**
 * Morning update (who is on site, today's plan, blockers) or evening report (work done, photos, progress,
 * material status, tomorrow's plan). One per site per day per kind – sending again the same day updates it.
 */
export async function submitSiteReport(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("site_reports:create");
    const d = schema.parse(formToObject(fd));

    const project = await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c) } });
    if (!project) throw new UserError("Site not found or you aren't assigned to it.");
    if (project.status === "COMPLETED" || project.status === "CANCELLED") throw new UserError("This project is closed – reports can't be added.");

    // morning: who came per trade (one count: it also fills the Manpower record); evening: how far each job of the day got
    const crew = parseList(fd.get("crew"), crewRow);
    const crewReason = String(fd.get("crewReason") ?? "").trim();
    if (crew.some((r) => r.present < r.planned) && !crewReason) throw new UserError("Fewer people came than planned: write why, in a line.");
    const taskUpdates = d.kind === "EVENING" ? parseList(fd.get("tasks"), taskRow) : [];
    if (taskUpdates.length && !c.can("tasks:edit")) throw new UserError("You can't update the schedule. Write the work done instead.");
    if (d.kind === "MORNING" && !d.planNext) throw new UserError("Write today's plan in a line or two.");
    if (d.kind === "EVENING" && !d.workDone && !taskUpdates.length) throw new UserError("Write what work was done today, or press how far each job got.");

    const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_PHOTOS) throw new UserError(`Add at most ${MAX_PHOTOS} photos per report.`);

    const day = reportDay();
    const existing = await db.dailyReport.findUnique({ where: { projectId_reportDate_kind: { projectId: project.id, reportDate: day, kind: d.kind } } });
    if (files.length + (existing?.photoIds.length ?? 0) === 0) throw new UserError(d.kind === "MORNING" ? "Add a start-of-day photo of the site." : "Add at least one end-of-day photo of the site.");
    if (existing && existing.submittedById !== c.userId && !c.can("site_reports:edit")) throw new UserError("Someone else already sent this report.");

    const saved: string[] = [];
    const photoIds: string[] = [];
    try {
      let n = (existing?.photoIds.length ?? 0) + 1;
      for (const f of files) {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        if (!IMAGE_EXT.includes(ext)) throw new UserError("Photos must be JPG, PNG or WebP images.");
        let v;
        try {
          v = await validateUpload(f);
        } catch (e) {
          if (e instanceof UploadError) throw new UserError(e.message);
          throw e;
        }
        const key = await putFile(c.companyId, v.bytes, v.ext);
        saved.push(key);
        const doc = await db.document.create({
          data: {
            companyId: c.companyId, name: `${project.code} ${d.kind === "MORNING" ? "morning" : "evening"} ${day.toISOString().slice(0, 10)} #${n++}.${v.ext}`,
            type: "SITE_PHOTO", folder: "Daily reports", entityType: "PROJECT", entityId: project.id, storageKey: key, mimeType: v.mime, size: v.size, uploadedById: c.userId,
          },
        });
        photoIds.push(doc.id);
      }

      const now = new Date();
      const t = await reportTimes(c.companyId);
      const lateUntil = d.kind === "EVENING" ? (await db.lateWork.findUnique({ where: { projectId_date: { projectId: project.id, date: day } } }))?.until : null;
      // the schedule first, so the report keeps the project progress it led to
      const tasksDone = taskUpdates.length ? await applyTaskProgress(c, project.id, taskUpdates) : [];
      if (crew.length) await recordCrew(c, project, day, crew, crewReason);
      const progress = taskUpdates.length ? (await db.project.findUnique({ where: { id: project.id }, select: { progress: true } }))?.progress ?? null : null;
      const workDone = [tasksDone.length ? tasksDone.join("; ") : null, d.workDone].filter(Boolean).join(". ") || null;
      const data = {
        manpower: d.manpower, progressPct: progress ?? d.progressPct ?? existing?.progressPct ?? null, workDone, planNext: d.planNext ?? null,
        materialStatus: d.materialStatus, issues: d.issues ?? null,
      };
      const report = existing
        ? await db.dailyReport.update({ where: { id: existing.id }, data: { ...data, photoIds: [...existing.photoIds, ...photoIds] } })
        : await db.dailyReport.create({
            data: { ...data, companyId: c.companyId, projectId: project.id, reportDate: day, kind: d.kind, submittedById: c.userId, submittedAt: now, onTime: isOnTime(d.kind, project.outstation, day, now, t, lateUntil), photoIds },
          });
      await audit(c, { action: existing ? "UPDATE" : "CREATE", entityType: "DailyReport", entityId: report.id, summary: `${existing ? "Updated" : "Sent"} ${d.kind.toLowerCase()} site report for ${project.code}` });

      // Tell the people who must act: PM on any problem; procurement/store when material is short.
      const trouble = d.materialStatus !== "OK" || !!d.issues;
      if (trouble && project.projectManagerId && !(existing && existing.materialStatus === d.materialStatus && existing.issues === (d.issues ?? null))) {
        const stopped = d.materialStatus === "WORK_STOPPED";
        await notifyUsers([project.projectManagerId], {
          companyId: c.companyId, type: "GENERAL", title: `${project.code}: ${stopped ? "WORK STOPPED – no material" : d.materialStatus === "SHORT_SOON" ? "material shortage coming" : "site issue reported"}`,
          body: d.issues ?? "See today's report.", link: `/site-reports/${report.id}`,
        });
        if (d.materialStatus !== "OK") {
          await notifyRoles(c.companyId, ["PROCUREMENT"], { type: "GENERAL", title: `${project.code}: site reports ${stopped ? "work stopped for material" : "material shortage soon"}`, body: d.issues ?? undefined, link: `/site-reports/${report.id}` });
        }
      }
      revalidatePath("/site-reports");
      revalidatePath("/today");
      if (taskUpdates.length) revalidatePath(`/projects/${project.id}`);
      return { message: report.onTime || existing ? "Report sent. Thank you!" : "Report sent (it was late).", data: { id: report.id } };
    } catch (e) {
      for (const key of saved) await deleteFile(key); // no orphan files if saving failed
      if (photoIds.length) await db.document.deleteMany({ where: { id: { in: photoIds } } });
      throw e;
    }
  });
}

const crewRow = z.object({ trade: z.string().trim().min(1).max(60), planned: z.coerce.number().int().min(0).max(500), present: z.coerce.number().int().min(0).max(500) });
const taskRow = z.object({ id: z.string().min(1), progress: z.coerce.number().int().min(0).max(100) });
function parseList<T>(raw: FormDataEntryValue | null, row: z.ZodType<T>): T[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new UserError("The form could not be read. Please reload the page."); }
  const r = z.array(row).max(80).safeParse(v);
  if (!r.success) throw new UserError("The form could not be read. Please reload the page.");
  return r.data;
}

/** How far each job of the day got, from the evening report: the same rules as changing a task by hand. Returns lines for the report. */
async function applyTaskProgress(c: Ctx, projectId: string, rows: { id: string; progress: number }[]): Promise<string[]> {
  const tasks = await db.projectTask.findMany({ where: { id: { in: rows.map((r) => r.id) }, projectId, companyId: c.companyId } });
  const deps = await db.projectTask.findMany({ where: { id: { in: tasks.map((t) => t.dependsOnId).filter((x): x is string => !!x) } }, select: { id: true, name: true, status: true } });
  const lines: string[] = [];
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const t = tasks.find((x) => x.id === r.id);
      if (!t || t.progress === r.progress) continue;
      const dep = deps.find((x) => x.id === t.dependsOnId);
      if (r.progress > 0 && dep && dep.status !== "COMPLETED") throw new UserError(`“${t.name}” can't move: “${dep.name}” must be finished first.`);
      const status = r.progress >= 100 ? "COMPLETED" : t.status === "BLOCKED" ? "BLOCKED" : r.progress > 0 ? "IN_PROGRESS" : "TODO";
      await tx.projectTask.update({ where: { id: t.id }, data: { progress: r.progress, status } });
      if (t.status === "BLOCKED" && status === "COMPLETED") await resolveActionsFor(tx, c.companyId, "ProjectTask", t.id, c.userId, "Finished (evening report).");
      lines.push(`${t.name}: ${r.progress >= 100 ? "finished" : `${r.progress}%`}`);
      await audit(c, { action: "UPDATE", entityType: "ProjectTask", entityId: t.id, summary: `Task ${t.code}: ${t.progress}% → ${r.progress}% (evening report)` }, tx);
    }
    await recalcProgress(tx, projectId);
  });
  return lines;
}

/** Who came per trade, from the morning update: the Manpower record of the day. Fewer than planned raises one action, as on the Manpower page. */
async function recordCrew(c: Ctx, p: { id: string; code: string; projectManagerId: string | null }, day: Date, rows: { trade: string; planned: number; present: number }[], reason: string) {
  for (const r of rows) {
    const short = r.present < r.planned;
    const log = await db.manpowerLog.upsert({
      where: { projectId_date_trade: { projectId: p.id, date: day, trade: r.trade } },
      create: { companyId: c.companyId, projectId: p.id, date: day, trade: r.trade, planned: r.planned, present: r.present, reason: short ? reason : null, recordedById: c.userId },
      update: { planned: r.planned, present: r.present, reason: short ? reason : null, recordedById: c.userId },
    });
    if (short) {
      const owner = await coordinatorFor(c.companyId, p.id);
      if (!owner) continue;
      const sev = shortDaySeverity(r.planned, r.present);
      const a = await raiseAction(db, {
        companyId: c.companyId, title: `${p.code}: only ${r.present} of ${r.planned} ${r.trade.toLowerCase()}${r.planned === 1 ? "" : "s"} came`, severity: sev, ownerId: owner, createdById: c.userId, projectId: p.id,
        dueDate: new Date(day.getTime() + 86400000 - 60000 + (sev === "CRITICAL" ? 0 : 86400000)), detail: reason, sourceType: "ManpowerLog", sourceId: log.id, sourceLabel: `${r.trade} headcount`, link: "/resources",
      });
      if (a.created && p.projectManagerId && p.projectManagerId !== owner) await notifyUsers([p.projectManagerId], { companyId: c.companyId, type: "GENERAL", title: `Crew short at ${p.code}`, body: `${r.trade}: ${r.present} of ${r.planned} came.`, link: "/resources", dedupeKey: `crew:${log.id}` });
    } else {
      await resolveActionsFor(db, c.companyId, "ManpowerLog", log.id, c.userId, "The day was corrected: everyone planned came.");
    }
  }
}

const lateSchema = z.object({
  until: z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Pick the time work will finish, for example 22:00"),
  reason: zOptStr,
});

/**
 * "We are working late today": the evening report is then due an hour after the given time, and nobody is chased before that.
 * The project manager is told, with the reason. Can be changed the same day; it is kept with the day.
 */
export async function setLateWork(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("site_reports:create");
    const d = lateSchema.parse(formToObject(fd));
    const project = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) }, select: { id: true, code: true, name: true, projectManagerId: true } });
    if (!project) throw new UserError("Site not found or you aren't assigned to it.");
    const until = d.until.padStart(5, "0");
    const t = await reportTimes(c.companyId);
    if (until <= t.reportEveningDue.padStart(5, "0")) throw new UserError(`That is not late: the evening report is due at ${t.reportEveningDue} anyway.`);
    const day = reportDay();
    await db.lateWork.upsert({ where: { projectId_date: { projectId, date: day } }, create: { companyId: c.companyId, projectId, date: day, until, reason: d.reason ?? null, createdById: c.userId }, update: { until, reason: d.reason ?? null, createdById: c.userId } });
    await audit(c, { action: "UPDATE", entityType: "LateWork", entityId: projectId, summary: `${project.code}: working late today until ${until}${d.reason ? ` (${d.reason})` : ""}` });
    if (project.projectManagerId && project.projectManagerId !== c.userId) {
      await notifyUsers([project.projectManagerId], { companyId: c.companyId, type: "GENERAL", title: `${project.code}: working late today until ${until}`, body: d.reason ?? `Sent by ${c.name}. The evening report will come after.`, link: "/site-reports", dedupeKey: `late:${projectId}:${day.toISOString().slice(0, 10)}:${until}` });
    }
    revalidatePath("/site-reports");
    return { message: `Noted: working until ${until}. The evening report is now due an hour after.` };
  });
}

export async function clearLateWork(projectId: string) {
  return run(async () => {
    const c = await assertPerm("site_reports:create");
    const project = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) }, select: { id: true, code: true } });
    if (!project) throw new UserError("Site not found or you aren't assigned to it.");
    await db.lateWork.deleteMany({ where: { projectId, date: reportDay() } });
    await audit(c, { action: "UPDATE", entityType: "LateWork", entityId: projectId, summary: `${project.code}: not working late today after all` });
    revalidatePath("/site-reports");
    return { message: "Back to the normal time" };
  });
}
