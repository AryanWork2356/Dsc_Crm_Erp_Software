"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionItem } from "@prisma/client";
import { db } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { projectScope } from "@/lib/scope";
import { notifyUsers } from "@/lib/notify";
import { dueIn, raiseAction } from "@/lib/action-items";
import { formToObject, zDate, zOptDate, zOptStr, zReqStr } from "@/lib/form";

const WIDE = ["OWNER", "MANAGEMENT", "ADMIN"];

/** The owner, the person who raised it, the project manager of its project, and the directors may change an action. */
async function mayChange(c: Ctx, a: ActionItem) {
  if (WIDE.includes(c.role) || a.ownerId === c.userId || a.createdById === c.userId) return true;
  if (!a.projectId) return false;
  return !!(await db.project.findFirst({ where: { id: a.projectId, companyId: c.companyId, projectManagerId: c.userId }, select: { id: true } }));
}

async function load(c: Ctx, id: string) {
  const a = await db.actionItem.findFirst({ where: { id, companyId: c.companyId } });
  if (!a) throw new UserError("Action not found.");
  return a;
}

const createSchema = z.object({
  title: zReqStr("Say what has to be done"),
  detail: zOptStr,
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  ownerId: zOptStr,
  projectId: zOptStr,
  dueDate: zOptDate,
});

export async function createActionItem(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("actions:create");
    const d = createSchema.parse(formToObject(fd));
    const ownerId = d.ownerId ?? c.userId;
    const owner = await db.user.findFirst({ where: { id: ownerId, companyId: c.companyId, isActive: true, deletedAt: null, role: { notIn: ["CLIENT", "VENDOR", "WORKER"] } }, select: { id: true } });
    if (!owner) throw new UserError("Choose someone from your team as the owner.");
    if (d.projectId) {
      const p = await db.project.findFirst({ where: { id: d.projectId, ...projectScope(c) }, select: { id: true } });
      if (!p) throw new UserError("Project not found or you don't have access to it.");
    }
    const dueDate = d.dueDate ?? dueIn(d.severity);
    const { action } = await raiseAction(db, { companyId: c.companyId, title: d.title, detail: d.detail, severity: d.severity, ownerId, createdById: c.userId, projectId: d.projectId, dueDate, link: d.projectId ? `/projects/${d.projectId}` : "/actions" });
    await audit(c, { action: "CREATE", entityType: "ActionItem", entityId: action.id, summary: `${c.name} raised ${action.number}: ${d.title}` });
    revalidatePath("/actions");
    return { message: `${action.number} added`, data: { id: action.id } };
  });
}

export async function startActionItem(id: string) {
  return run(async () => {
    const c = await assertPerm("actions:edit");
    const a = await load(c, id);
    if (!(await mayChange(c, a))) throw new UserError("Only the owner, the person who raised it, the project manager or a director can change this action.");
    if (a.status !== "OPEN") throw new UserError("Only an open action can be started.");
    await db.actionItem.update({ where: { id }, data: { status: "IN_PROGRESS" } });
    await audit(c, { action: "UPDATE", entityType: "ActionItem", entityId: id, summary: `${c.name} started ${a.number}` });
    revalidatePath("/actions");
    return { message: "Marked in progress" };
  });
}

export async function resolveActionItem(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("actions:edit");
    const { resolution } = z.object({ resolution: zReqStr("Write what was done (this is the proof it is finished)") }).parse(formToObject(fd));
    const a = await load(c, id);
    if (!(await mayChange(c, a))) throw new UserError("Only the owner, the person who raised it, the project manager or a director can change this action.");
    if (!["OPEN", "IN_PROGRESS"].includes(a.status)) throw new UserError("This action is already closed.");
    await db.actionItem.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: c.userId, resolution } });
    await audit(c, { action: "UPDATE", entityType: "ActionItem", entityId: id, summary: `${c.name} resolved ${a.number}: ${resolution}` });
    if (a.createdById !== c.userId) await notifyUsers([a.createdById], { companyId: c.companyId, type: "GENERAL", title: `Resolved: ${a.title}`, body: resolution, link: "/actions", dedupeKey: `action:${id}:resolved` });
    revalidatePath("/actions");
    return { message: `${a.number} resolved` };
  });
}

export async function cancelActionItem(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("actions:edit");
    const { reason } = z.object({ reason: zReqStr("Say why it is not needed") }).parse(formToObject(fd));
    const a = await load(c, id);
    if (!(await mayChange(c, a))) throw new UserError("Only the owner, the person who raised it, the project manager or a director can change this action.");
    if (!["OPEN", "IN_PROGRESS"].includes(a.status)) throw new UserError("This action is already closed.");
    await db.actionItem.update({ where: { id }, data: { status: "CANCELLED", resolvedAt: new Date(), resolvedById: c.userId, resolution: reason } });
    await audit(c, { action: "UPDATE", entityType: "ActionItem", entityId: id, summary: `${c.name} cancelled ${a.number}: ${reason}` });
    revalidatePath("/actions");
    return { message: `${a.number} cancelled` };
  });
}

const reassignSchema = z.object({ ownerId: zReqStr("Choose the new owner"), dueDate: zDate("Pick the new due date"), reason: zReqStr("Say why the owner or date is changing") });

/** New owner and/or new due date. The reason is recorded and the new owner is told. */
export async function reassignActionItem(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("actions:edit");
    const d = reassignSchema.parse(formToObject(fd));
    const a = await load(c, id);
    if (!(await mayChange(c, a))) throw new UserError("Only the owner, the person who raised it, the project manager or a director can change this action.");
    if (!["OPEN", "IN_PROGRESS"].includes(a.status)) throw new UserError("This action is already closed.");
    const owner = await db.user.findFirst({ where: { id: d.ownerId, companyId: c.companyId, isActive: true, deletedAt: null, role: { notIn: ["CLIENT", "VENDOR", "WORKER"] } }, select: { id: true } });
    if (!owner) throw new UserError("Choose someone from your team as the owner.");
    await db.actionItem.update({ where: { id }, data: { ownerId: d.ownerId, dueDate: d.dueDate } });
    await audit(c, { action: "UPDATE", entityType: "ActionItem", entityId: id, summary: `${c.name} changed ${a.number} (owner/due date): ${d.reason}`, oldValue: { ownerId: a.ownerId, dueDate: a.dueDate }, newValue: { ownerId: d.ownerId, dueDate: d.dueDate } });
    if (d.ownerId !== a.ownerId) await notifyUsers([d.ownerId], { companyId: c.companyId, type: "GENERAL", title: `Action assigned to you: ${a.title}`, body: `Due ${d.dueDate.toLocaleDateString("en-IN")}`, link: "/actions", dedupeKey: `action:${id}:to:${d.ownerId}:${d.dueDate.toISOString().slice(0, 10)}` });
    revalidatePath("/actions");
    return { message: "Updated" };
  });
}
