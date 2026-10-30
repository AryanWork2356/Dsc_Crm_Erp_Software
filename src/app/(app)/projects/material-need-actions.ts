"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCtx, PermissionError, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { projectScope } from "@/lib/scope";
import { formToObject, zDate, zOptStr, zReqStr } from "@/lib/form";
import { resolveActionsFor } from "@/lib/action-items";

/**
 * The materials list of a project schedule, kept by hand (the Excel upload fills it too). Like the schedule, it is planned by the
 * people who may add tasks (directors and admins); coordinators and managers see it.
 */
const needSchema = z.object({
  description: zReqStr("Write the material"),
  quantity: z.coerce.number({ message: "Enter a valid number" }).positive("Quantity must be above 0").max(1e9),
  unit: zOptStr,
  neededBy: zDate("Pick the day it must be on site"),
  taskId: zOptStr,
  note: zOptStr,
});

async function planner(): Promise<Ctx> {
  const c = await getCtx();
  if (!c) throw new Error("Your session has expired. Please sign in again.");
  if (!c.can("tasks:create")) throw new PermissionError("tasks:create"); // the materials list is part of the schedule: planned by directors and admins
  return c;
}
async function project(c: Ctx, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(c) }, select: { id: true, code: true } });
  if (!p) throw new UserError("Project not found.");
  return p;
}
function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/procurement/needs");
}

async function fields(c: Ctx, projectId: string, fd: FormData) {
  const d = needSchema.parse(formToObject(fd));
  if (d.neededBy.getUTCFullYear() < 2000 || d.neededBy.getUTCFullYear() > 2100) throw new UserError("The date is not sensible.");
  const task = d.taskId ? await db.projectTask.findFirst({ where: { id: d.taskId, projectId }, select: { id: true, name: true } }) : null;
  const cat = await db.material.findFirst({ where: { companyId: c.companyId, deletedAt: null, name: { equals: d.description, mode: "insensitive" } }, select: { id: true, name: true, unit: true } });
  return { materialId: cat?.id ?? null, description: (cat?.name ?? d.description).slice(0, 200), unit: (d.unit || cat?.unit || "nos").slice(0, 20), quantity: d.quantity, neededBy: d.neededBy, taskId: task?.id ?? null, forWork: task?.name ?? null, note: d.note?.slice(0, 500) ?? null };
}

export async function createMaterialNeed(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await planner();
    const p = await project(c, projectId);
    const data = await fields(c, projectId, fd);
    const n = await db.materialNeed.create({ data: { ...data, companyId: c.companyId, projectId, createdById: c.userId } });
    await audit(c, { action: "CREATE", entityType: "MaterialNeed", entityId: n.id, summary: `Added ${data.quantity} ${data.unit} ${data.description} needed on ${data.neededBy.toISOString().slice(0, 10)} to ${p.code}` });
    refresh(projectId);
    return { message: "Added to the materials list" };
  });
}

export async function updateMaterialNeed(needId: string, fd: FormData) {
  return run(async () => {
    const c = await planner();
    const n = await db.materialNeed.findFirst({ where: { id: needId, companyId: c.companyId } });
    if (!n) throw new UserError("That line is not there any more.");
    const p = await project(c, n.projectId);
    const data = await fields(c, n.projectId, fd);
    await db.materialNeed.update({ where: { id: needId }, data });
    await audit(c, { action: "UPDATE", entityType: "MaterialNeed", entityId: needId, summary: `Changed material line ${data.description} of ${p.code}`, oldValue: { quantity: n.quantity.toString(), neededBy: n.neededBy }, newValue: { quantity: data.quantity, neededBy: data.neededBy } });
    refresh(n.projectId);
    return { message: "Saved" };
  });
}

export async function deleteMaterialNeed(needId: string) {
  return run(async () => {
    const c = await planner();
    const n = await db.materialNeed.findFirst({ where: { id: needId, companyId: c.companyId } });
    if (!n) throw new UserError("That line is not there any more.");
    const p = await project(c, n.projectId);
    await db.$transaction(async (tx) => {
      await tx.materialNeed.delete({ where: { id: needId } });
      await resolveActionsFor(tx, c.companyId, "MaterialNeed", needId, c.userId, "The line was taken off the materials list.");
    });
    await audit(c, { action: "DELETE", entityType: "MaterialNeed", entityId: needId, summary: `Removed ${n.description} from the materials list of ${p.code}` });
    refresh(n.projectId);
    return { message: "Removed" };
  });
}
