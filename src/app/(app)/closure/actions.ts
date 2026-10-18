"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { notifyRoles } from "@/lib/notify";
import { projectScope } from "@/lib/scope";
import { putFile, deleteFile, validateUpload, UploadError } from "@/lib/storage";
import { ensureClosure, loadClosure } from "@/lib/closure";

async function project(c: Ctx, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) } });
  if (!p) throw new UserError("Project not found or you aren't on it.");
  return p;
}
async function itemOf(c: Ctx, itemId: string) {
  const i = await db.projectClosureItem.findFirst({ where: { id: itemId, closure: { companyId: c.companyId } }, include: { closure: true } });
  if (!i) throw new UserError("Checklist item not found.");
  await project(c, i.closure.projectId);
  if (i.closure.status === "CLOSED") throw new UserError("This project is already closed.");
  return i;
}
const refresh = (projectId: string) => { revalidatePath("/closure"); revalidatePath(`/closure/${projectId}`); };

export async function startClosure(projectId: string) {
  return run(async () => {
    const c = await assertPerm("closure:create");
    const p = await project(c, projectId);
    if (!["SNAGGING", "HANDOVER", "COMPLETED"].includes(p.status)) throw new UserError("The closure checklist starts once the project reaches snagging, handover or completion.");
    const r = await db.$transaction(async (tx) => {
      const x = await ensureClosure(tx, c.companyId, projectId);
      if (x.created) await audit(c, { action: "CREATE", entityType: "ProjectClosure", entityId: projectId, summary: `Started the closure checklist for ${p.code}` }, tx);
      return x;
    });
    refresh(projectId);
    return { message: r.created ? "Checklist started" : "Checklist already exists" };
  });
}

/** Marks a manual item done. Items that need a document refuse until one is attached. */
export async function markClosureItem(itemId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("closure:edit");
    const i = await itemOf(c, itemId);
    if (i.auto) throw new UserError("This item is checked by the system – fix the cause and it turns green by itself.");
    const note = String(fd.get("note") ?? "").trim() || null;
    const f = fd.get("file");
    let up: Awaited<ReturnType<typeof validateUpload>> | null = null;
    if (f instanceof File && f.size > 0) {
      try {
        up = await validateUpload(f);
      } catch (e) {
        if (e instanceof UploadError) throw new UserError(e.message);
        throw e;
      }
    }
    if (i.docRequired && !up && !i.docId) throw new UserError("Attach the document (photo, PDF or scan) to mark this done.");
    const key = up ? await putFile(c.companyId, up.bytes, up.ext) : null;
    try {
      await db.$transaction(async (tx) => {
        let docId = i.docId;
        if (up && key) {
          const d = await tx.document.create({ data: { companyId: c.companyId, name: `${i.title}.${up.ext}`, type: i.key.includes("photo") ? "SITE_PHOTO" : i.key === "warranty_certs" ? "WARRANTY" : "PROJECT_REPORT", folder: "Project closure", entityType: "PROJECT", entityId: i.closure.projectId, storageKey: key, mimeType: up.mime, size: up.size, uploadedById: c.userId } });
          docId = d.id;
        }
        await tx.projectClosureItem.update({ where: { id: itemId }, data: { done: true, doneAt: new Date(), doneById: c.userId, note, docId } });
        await audit(c, { action: "UPDATE", entityType: "ProjectClosure", entityId: i.closure.projectId, summary: `Closure item done: ${i.title}` }, tx);
      });
    } catch (e) {
      if (key) await deleteFile(key);
      throw e;
    }
    refresh(i.closure.projectId);
    return { message: "Marked done" };
  });
}

export async function reopenClosureItem(itemId: string) {
  return run(async () => {
    const c = await assertPerm("closure:edit");
    const i = await itemOf(c, itemId);
    if (i.auto) throw new UserError("This item is checked by the system.");
    if (i.closure.status === "SUBMITTED") throw new UserError("The report was already submitted.");
    await db.projectClosureItem.update({ where: { id: itemId }, data: { done: false, doneAt: null, doneById: null } });
    refresh(i.closure.projectId);
    return { message: "Reopened" };
  });
}

/** The Project Director's lessons-learned note. Needs approval rights (Management / Owner / Admin). */
export async function saveLessons(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("closure:approve");
    const p = await project(c, projectId);
    const text = String(fd.get("lessons") ?? "").trim();
    if (text.length < 10) throw new UserError("Write the lessons learned in a few lines (at least 10 characters).");
    const cl = await db.projectClosure.findUnique({ where: { projectId } });
    if (!cl || cl.companyId !== c.companyId) throw new UserError("Start the closure checklist first.");
    if (cl.status === "CLOSED") throw new UserError("This project is already closed.");
    await db.projectClosure.update({ where: { projectId }, data: { lessonsLearned: text } });
    await audit(c, { action: "UPDATE", entityType: "ProjectClosure", entityId: projectId, summary: `Wrote lessons learned for ${p.code}` });
    refresh(projectId);
    return { message: "Lessons learned saved" };
  });
}

export async function submitClosureReport(projectId: string) {
  return run(async () => {
    const c = await assertPerm("closure:edit");
    const p = await project(c, projectId);
    const v = await loadClosure(c.companyId, projectId);
    if (!v) throw new UserError("Start the closure checklist first.");
    if (v.closure.status !== "OPEN") throw new UserError("The report has already been submitted.");
    if (v.missing.length) throw new UserError(`${v.missing.length} item(s) are not done yet: ${v.missing.slice(0, 3).join("; ")}${v.missing.length > 3 ? "…" : ""}`);
    await db.$transaction(async (tx) => {
      await tx.projectClosure.update({ where: { projectId }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedById: c.userId } });
      await audit(c, { action: "UPDATE", entityType: "ProjectClosure", entityId: projectId, summary: `Submitted the closure report for ${p.code}` }, tx);
      await notifyRoles(c.companyId, ["MANAGEMENT", "OWNER"], { type: "GENERAL", title: `Closure report ready: ${p.code} ${p.name}`, body: "All 15 items are complete. Please review and close the project.", link: `/closure/${projectId}`, dedupeKey: `closure-submitted:${projectId}` }, tx);
    });
    refresh(projectId);
    return { message: "Closure report sent to the directors" };
  });
}

export async function approveClosure(projectId: string) {
  return run(async () => {
    const c = await assertPerm("closure:approve");
    const p = await project(c, projectId);
    const cl = await db.projectClosure.findUnique({ where: { projectId } });
    if (!cl || cl.companyId !== c.companyId) throw new UserError("No closure checklist for this project.");
    if (cl.status !== "SUBMITTED") throw new UserError(cl.status === "CLOSED" ? "Already closed." : "The closure report hasn't been submitted yet.");
    await db.$transaction(async (tx) => {
      await tx.projectClosure.update({ where: { projectId }, data: { status: "CLOSED", closedAt: new Date(), closedById: c.userId } });
      if (p.status !== "COMPLETED") await tx.project.update({ where: { id: projectId }, data: { status: "COMPLETED", actualEndDate: p.actualEndDate ?? new Date(), progress: 100 } });
      await audit(c, { action: "APPROVE", entityType: "ProjectClosure", entityId: projectId, summary: `Closed project ${p.code} after review of the closure report` }, tx);
    });
    refresh(projectId);
    revalidatePath(`/projects/${projectId}`);
    return { message: "Project closed" };
  });
}
