"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getCtx, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextNumber } from "@/lib/sequence";
import { notifyUsers } from "@/lib/notify";
import { requestApproval } from "@/lib/workflow";
import { recalcProgress } from "@/lib/project-progress";
import { formToObject, zOptStr, zReqStr } from "@/lib/form";

async function workerCtx(): Promise<Ctx & { workerId: string }> {
  const c = await getCtx();
  if (!c || c.role !== "WORKER" || !c.workerId) throw new UserError("Please sign in with your worker account.");
  return c as Ctx & { workerId: string };
}

async function myProject(c: Ctx & { workerId: string }) {
  const w = await db.worker.findFirst({ where: { id: c.workerId, companyId: c.companyId, isActive: true } });
  const p = w?.currentProjectId ? await db.project.findFirst({ where: { id: w.currentProjectId, companyId: c.companyId, deletedAt: null } }) : null;
  return { w, p };
}

/** Workers can only move tasks assigned to THEM. */
export async function workerTaskStatus(taskId: string, status: string) {
  return run(async () => {
    const c = await workerCtx();
    const s = z.enum(["IN_PROGRESS", "COMPLETED", "BLOCKED"]).parse(status) as TaskStatus;
    const t = await db.projectTask.findFirst({ where: { id: taskId, companyId: c.companyId, OR: [{ workerId: c.workerId }, { assignedToId: c.userId }] } });
    if (!t) throw new UserError("This task isn't assigned to you.");
    if (t.dependsOnId) {
      const dep = await db.projectTask.findUnique({ where: { id: t.dependsOnId } });
      if (dep && dep.status !== "COMPLETED" && s !== "BLOCKED") throw new UserError(`Wait – “${dep.name}” isn't finished yet.`);
    }
    const progress = s === "COMPLETED" ? 100 : s === "IN_PROGRESS" ? Math.max(t.progress, 5) : t.progress;
    const p = await db.project.findUniqueOrThrow({ where: { id: t.projectId } });
    await db.$transaction(async (tx) => {
      await tx.projectTask.update({ where: { id: taskId }, data: { status: s, progress } });
      await recalcProgress(tx, t.projectId);
      await audit(c, { action: "UPDATE", entityType: "ProjectTask", entityId: taskId, summary: `${c.name} set task ${t.code} to ${s.toLowerCase().replace("_", " ")} from the site app` }, tx);
      if (s === "COMPLETED" || s === "BLOCKED") await notifyUsers([p.projectManagerId, p.supervisorId].filter((u): u is string => !!u), { companyId: c.companyId, type: "GENERAL", title: `${t.name}: ${s === "COMPLETED" ? "completed" : "BLOCKED"} by ${c.name}`, body: p.name, link: `/projects/${p.id}?tab=tasks` }, tx);
    });
    revalidatePath("/worker");
    return { message: s === "COMPLETED" ? "Done – well done!" : s === "BLOCKED" ? "Marked as stuck – your supervisor has been told" : "Started" };
  });
}

/** A free-text material request becomes a purchase request in the project manager's approval queue. */
export async function workerRequestMaterial(fd: FormData) {
  return run(async () => {
    const c = await workerCtx();
    const d = z.object({ item: zReqStr("What do you need?"), quantity: z.coerce.number({ message: "How many?" }).positive("How many?"), unit: z.string().trim().default("nos"), note: zOptStr }).parse(formToObject(fd));
    const { p } = await myProject(c);
    if (!p) throw new UserError("You aren't assigned to a site yet. Ask your supervisor.");
    await db.$transaction(async (tx) => {
      const number = await nextNumber(tx, c.companyId, "PR");
      const pr = await tx.purchaseRequest.create({
        data: { companyId: c.companyId, number, projectId: p.id, requestedById: c.userId, reason: `Site request from ${c.name}${d.note ? `: ${d.note}` : ""}`, priority: "HIGH", status: "PENDING_APPROVAL", requiredDate: new Date(Date.now() + 2 * 86400000), items: { create: { description: d.item, unit: d.unit, quantity: d.quantity } } },
      });
      await requestApproval(tx, c, { type: "PURCHASE_REQUEST", entityType: "PurchaseRequest", entityId: pr.id, title: `Purchase request ${number} (site)`, amount: 0 });
      await audit(c, { action: "CREATE", entityType: "PurchaseRequest", entityId: pr.id, summary: `${c.name} requested ${d.quantity} ${d.unit} ${d.item} for ${p.code} from the site app` }, tx);
      await notifyUsers([p.projectManagerId, p.supervisorId, p.siteEngineerId].filter((u): u is string => !!u), { companyId: c.companyId, type: "PO_PENDING", title: `Material request: ${d.quantity} ${d.unit} ${d.item}`, body: `${c.name} · ${p.name}`, link: `/procurement/requests/${pr.id}` }, tx);
    });
    revalidatePath("/worker");
    return { message: "Request sent to your project manager" };
  });
}

export async function workerReportIssue(fd: FormData) {
  return run(async () => {
    const c = await workerCtx();
    const d = z.object({ issue: z.string().trim().min(3, "Please describe the problem").max(1000) }).parse(formToObject(fd));
    const { p } = await myProject(c);
    const people = p ? [p.projectManagerId, p.supervisorId, p.siteEngineerId].filter((u): u is string => !!u) : [];
    if (!people.length) throw new UserError("No supervisor is assigned to your site yet. Please tell someone in person.");
    await notifyUsers(people, { companyId: c.companyId, type: "GENERAL", title: `⚠ Issue reported on site by ${c.name}`, body: d.issue, link: p ? `/projects/${p.id}` : undefined });
    await audit(c, { action: "CREATE", entityType: "SiteIssue", entityId: p?.id, summary: `${c.name} reported a site issue${p ? ` at ${p.code}` : ""}: ${d.issue.slice(0, 160)}` });
    return { message: "Your supervisor has been told" };
  });
}
