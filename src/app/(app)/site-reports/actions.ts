"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReportKind, SiteMaterialStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm } from "@/lib/auth";
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

    if (d.kind === "MORNING" && !d.planNext) throw new UserError("Write today's plan in a line or two.");
    if (d.kind === "EVENING" && !d.workDone) throw new UserError("Write what work was done today.");

    const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_PHOTOS) throw new UserError(`Add at most ${MAX_PHOTOS} photos per report.`);

    const day = reportDay();
    const existing = await db.dailyReport.findUnique({ where: { projectId_reportDate_kind: { projectId: project.id, reportDate: day, kind: d.kind } } });
    if (d.kind === "EVENING" && files.length + (existing?.photoIds.length ?? 0) === 0) throw new UserError("Add at least one site photo.");
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
      const data = {
        manpower: d.manpower, progressPct: d.progressPct ?? null, workDone: d.workDone ?? null, planNext: d.planNext ?? null,
        materialStatus: d.materialStatus, issues: d.issues ?? null,
      };
      const report = existing
        ? await db.dailyReport.update({ where: { id: existing.id }, data: { ...data, photoIds: [...existing.photoIds, ...photoIds] } })
        : await db.dailyReport.create({
            data: { ...data, companyId: c.companyId, projectId: project.id, reportDate: day, kind: d.kind, submittedById: c.userId, submittedAt: now, onTime: isOnTime(d.kind, project.outstation, day, now, t), photoIds },
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
      return { message: report.onTime || existing ? "Report sent. Thank you!" : "Report sent (it was late).", data: { id: report.id } };
    } catch (e) {
      for (const key of saved) await deleteFile(key); // no orphan files if saving failed
      if (photoIds.length) await db.document.deleteMany({ where: { id: { in: photoIds } } });
      throw e;
    }
  });
}
