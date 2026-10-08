"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Priority, ProjectStatus, SegmentType, TaskStatus } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { assertPerm, type Ctx } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { run, UserError } from "@/lib/action";
import { nextNumber } from "@/lib/sequence";
import { notifyUsers } from "@/lib/notify";
import { projectScope } from "@/lib/scope";
import { recalcProgress } from "@/lib/project-progress";
import { formToObject, zNumPos, zOptDate, zOptStr, zReqStr } from "@/lib/form";
import { humanize, num } from "@/lib/utils";

async function getProject(c: Ctx, id: string, tx: Tx | typeof db = db) {
  const p = await tx.project.findFirst({ where: { id, ...projectScope(c) } });
  if (!p) throw new UserError("Project not found or you don't have access to it.");
  return p;
}

// ───────────── PROJECT ─────────────
const projectSchema = z.object({
  name: zReqStr("Project name is required"),
  clientId: zReqStr("Select a client"),
  segment: z.nativeEnum(SegmentType).default("RESIDENTIAL"),
  siteAddress: zOptStr,
  startDate: zOptDate,
  plannedEndDate: zOptDate,
  projectManagerId: zOptStr,
  designerId: zOptStr,
  siteEngineerId: zOptStr,
  supervisorId: zOptStr,
  contractValue: zNumPos().default(0),
  budget: zNumPos().default(0),
});

function checkDates(d: { startDate?: Date; plannedEndDate?: Date }) {
  if (d.startDate && d.plannedEndDate && d.plannedEndDate < d.startDate) throw new UserError("Planned completion can't be before the start date.");
}

async function syncMembers(tx: Tx, projectId: string, d: z.infer<typeof projectSchema>) {
  const wanted: [string | undefined, string][] = [[d.projectManagerId, "Project Manager"], [d.designerId, "Designer"], [d.siteEngineerId, "Site Engineer"], [d.supervisorId, "Supervisor"]];
  for (const [uid, label] of wanted) {
    if (uid) await tx.projectMember.upsert({ where: { projectId_userId: { projectId, userId: uid } }, update: { roleLabel: label }, create: { projectId, userId: uid, roleLabel: label } });
  }
}

export async function createProject(fd: FormData) {
  return run(async () => {
    const c = await assertPerm("projects:create");
    const d = projectSchema.parse(formToObject(fd));
    checkDates(d);
    const client = await db.client.findFirst({ where: { id: d.clientId, companyId: c.companyId, deletedAt: null } });
    if (!client) throw new UserError("Client not found.");
    const p = await db.$transaction(async (tx) => {
      const code = await nextNumber(tx, c.companyId, "PRJ");
      const x = await tx.project.create({ data: { ...d, companyId: c.companyId, code, status: "PLANNING" } });
      await syncMembers(tx, x.id, d);
      await audit(c, { action: "CREATE", entityType: "Project", entityId: x.id, summary: `Created project ${code} – ${d.name}`, newValue: d }, tx);
      await notifyUsers([d.projectManagerId, d.siteEngineerId, d.supervisorId, d.designerId].filter((u): u is string => !!u && u !== c.userId), { companyId: c.companyId, type: "GENERAL", title: `You're on project ${d.name}`, link: `/projects/${x.id}` }, tx);
      return x;
    });
    revalidatePath("/projects");
    return { message: `Project ${p.code} created`, data: { id: p.id } };
  });
}

export async function updateProject(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("projects:edit");
    const d = projectSchema.parse(formToObject(fd));
    checkDates(d);
    const old = await getProject(c, id);
    // people who can edit but can't see money may not change contract value / budget
    const money = c.can("margins:view") ? { contractValue: d.contractValue, budget: d.budget } : {};
    await db.$transaction(async (tx) => {
      await tx.project.update({ where: { id }, data: { name: d.name, clientId: d.clientId, segment: d.segment, siteAddress: d.siteAddress, startDate: d.startDate, plannedEndDate: d.plannedEndDate, projectManagerId: d.projectManagerId ?? null, designerId: d.designerId ?? null, siteEngineerId: d.siteEngineerId ?? null, supervisorId: d.supervisorId ?? null, ...money } });
      await syncMembers(tx, id, d);
      const changed = "contractValue" in money && num(old.contractValue) !== d.contractValue;
      await audit(c, { action: "UPDATE", entityType: "Project", entityId: id, summary: changed ? `${c.name} changed contract value of ${old.code} from ₹${num(old.contractValue).toLocaleString("en-IN")} to ₹${d.contractValue.toLocaleString("en-IN")}` : `Updated project ${old.code}`, oldValue: { contractValue: num(old.contractValue), budget: num(old.budget) }, newValue: money }, tx);
      const newPeople = [d.projectManagerId, d.siteEngineerId, d.supervisorId, d.designerId].filter((u): u is string => !!u && ![old.projectManagerId, old.siteEngineerId, old.supervisorId, old.designerId].includes(u) && u !== c.userId);
      await notifyUsers(newPeople, { companyId: c.companyId, type: "GENERAL", title: `You've been added to project ${d.name}`, link: `/projects/${id}` }, tx);
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { message: "Project updated" };
  });
}

const ORDER: ProjectStatus[] = ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER", "COMPLETED"];

export async function changeProjectStatus(id: string, status: string) {
  return run(async () => {
    const c = await assertPerm("projects:edit");
    const s = z.nativeEnum(ProjectStatus).parse(status);
    const p = await getProject(c, id);
    if (p.status === s) return { message: "No change" };
    if (p.status === "CANCELLED" && s !== "PLANNING") throw new UserError("A cancelled project can only be reopened to Planning.");
    if (s === "COMPLETED") {
      const open = await db.projectTask.count({ where: { projectId: id, status: { not: "COMPLETED" } } });
      if (open > 0) throw new UserError(`${open} task(s) are still open. Complete or remove them before marking the project completed.`);
    }
    await db.$transaction(async (tx) => {
      await tx.project.update({
        where: { id },
        data: { status: s, actualEndDate: s === "COMPLETED" ? new Date() : s === "CANCELLED" ? p.actualEndDate : null, ...(s === "COMPLETED" ? { progress: 100 } : {}), ...(s === "EXECUTION" && !p.startDate ? { startDate: new Date() } : {}) },
      });
      await audit(c, { action: "UPDATE", entityType: "Project", entityId: id, summary: `Project ${p.code} moved from ${humanize(p.status)} to ${humanize(s)}`, oldValue: { status: p.status }, newValue: { status: s } }, tx);
      const forward = ORDER.indexOf(s) > ORDER.indexOf(p.status);
      if (forward || s === "ON_HOLD" || s === "CANCELLED") {
        await notifyUsers([p.projectManagerId, p.siteEngineerId, p.supervisorId, p.designerId].filter((u): u is string => !!u && u !== c.userId), { companyId: c.companyId, type: "GENERAL", title: `${p.name}: now ${humanize(s)}`, link: `/projects/${id}` }, tx);
      }
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    return { message: `Status: ${humanize(s)}` };
  });
}

/** Sets the project budget to the estimated cost of its current BOQ. */
export async function syncBudgetFromBoq(id: string) {
  return run(async () => {
    const c = await assertPerm("projects:edit");
    if (!c.can("margins:view")) throw new UserError("You don't have access to project costs.");
    const p = await getProject(c, id);
    const boqs = await db.boq.findMany({ where: { projectId: id, deletedAt: null, status: { not: "REVISED" } }, include: { items: { select: { estimatedCost: true } } }, orderBy: { revision: "desc" } });
    const boq = boqs.find((b) => b.status === "APPROVED") ?? boqs[0];
    if (!boq) throw new UserError("This project has no BOQ yet.");
    const cost = boq.items.reduce((s, i) => s + num(i.estimatedCost), 0);
    if (cost <= 0) throw new UserError("The BOQ has no estimated costs yet. Fill in material/labour costs first.");
    await db.project.update({ where: { id }, data: { budget: cost } });
    await audit(c, { action: "UPDATE", entityType: "Project", entityId: id, summary: `Budget of ${p.code} set to ₹${cost.toLocaleString("en-IN")} from BOQ ${boq.number}`, oldValue: { budget: num(p.budget) }, newValue: { budget: cost } });
    revalidatePath(`/projects/${id}`);
    return { message: `Budget set to ₹${cost.toLocaleString("en-IN")}` };
  });
}

export async function deleteProject(id: string) {
  return run(async () => {
    const c = await assertPerm("projects:delete");
    const p = await getProject(c, id);
    const [inv, po, exp, att, issues] = await Promise.all([
      db.invoice.count({ where: { projectId: id, deletedAt: null } }), db.purchaseOrder.count({ where: { projectId: id } }),
      db.expense.count({ where: { projectId: id } }), db.attendance.count({ where: { projectId: id } }), db.materialIssue.count({ where: { projectId: id } }),
    ]);
    if (inv + po + exp + att + issues > 0) throw new UserError("This project already has invoices, purchase orders, expenses or site records. Cancel it instead of deleting.");
    await db.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(c, { action: "DELETE", entityType: "Project", entityId: id, summary: `Deleted project ${p.code} – ${p.name}` });
    revalidatePath("/projects");
    return { message: "Project deleted" };
  });
}

// ───────────── TASKS ─────────────
const taskSchema = z.object({
  name: zReqStr("Task name is required"),
  description: zOptStr,
  assignedToId: zOptStr,
  workerId: zOptStr,
  priority: z.nativeEnum(Priority).default("MEDIUM"),
  startDate: zOptDate,
  dueDate: zOptDate,
  dependsOnId: zOptStr,
});

export async function createTask(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("tasks:create");
    const d = taskSchema.parse(formToObject(fd));
    checkDates({ startDate: d.startDate, plannedEndDate: d.dueDate });
    const p = await getProject(c, projectId);
    if (d.dependsOnId) {
      const dep = await db.projectTask.findFirst({ where: { id: d.dependsOnId, projectId } });
      if (!dep) throw new UserError("The task it depends on isn't in this project.");
    }
    const t = await db.$transaction(async (tx) => {
      const code = await nextNumber(tx, c.companyId, "TSK");
      const x = await tx.projectTask.create({ data: { ...d, companyId: c.companyId, projectId, code } });
      await recalcProgress(tx, projectId);
      await audit(c, { action: "CREATE", entityType: "ProjectTask", entityId: x.id, summary: `Created task ${code} “${d.name}” in ${p.code}` }, tx);
      if (d.assignedToId && d.assignedToId !== c.userId) await notifyUsers([d.assignedToId], { companyId: c.companyId, type: "TASK_DEADLINE", title: `New task: ${d.name}`, body: `${p.name}${d.dueDate ? ` · due ${d.dueDate.toLocaleDateString("en-IN")}` : ""}`, link: `/projects/${projectId}?tab=tasks` }, tx);
      return x;
    });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects/tasks");
    return { message: `Task ${t.code} added` };
  });
}

export async function updateTask(taskId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("tasks:edit");
    const d = taskSchema.parse(formToObject(fd));
    checkDates({ startDate: d.startDate, plannedEndDate: d.dueDate });
    const t = await db.projectTask.findFirst({ where: { id: taskId, companyId: c.companyId } });
    if (!t) throw new UserError("Task not found.");
    await getProject(c, t.projectId);
    if (d.dependsOnId === taskId) throw new UserError("A task can't depend on itself.");
    await db.$transaction(async (tx) => {
      await tx.projectTask.update({ where: { id: taskId }, data: { ...d, assignedToId: d.assignedToId ?? null, workerId: d.workerId ?? null, dependsOnId: d.dependsOnId ?? null } });
      await audit(c, { action: "UPDATE", entityType: "ProjectTask", entityId: taskId, summary: `Updated task ${t.code}` }, tx);
      if (d.assignedToId && d.assignedToId !== t.assignedToId && d.assignedToId !== c.userId) await notifyUsers([d.assignedToId], { companyId: c.companyId, type: "TASK_DEADLINE", title: `Task assigned: ${d.name}`, link: `/projects/${t.projectId}?tab=tasks` }, tx);
    });
    revalidatePath(`/projects/${t.projectId}`);
    revalidatePath("/projects/tasks");
    return { message: "Task updated" };
  });
}

const statusProgress: Record<TaskStatus, number | null> = { TODO: 0, IN_PROGRESS: null, BLOCKED: null, COMPLETED: 100 };

export async function setTaskStatus(taskId: string, status: string, progress?: number) {
  return run(async () => {
    const c = await assertPerm("tasks:edit");
    const s = z.nativeEnum(TaskStatus).parse(status);
    const t = await db.projectTask.findFirst({ where: { id: taskId, companyId: c.companyId } });
    if (!t) throw new UserError("Task not found.");
    await getProject(c, t.projectId);
    if (s !== "TODO" && t.dependsOnId) {
      const dep = await db.projectTask.findUnique({ where: { id: t.dependsOnId } });
      if (dep && dep.status !== "COMPLETED" && s !== "BLOCKED") throw new UserError(`Finish “${dep.name}” first – this task depends on it.`);
    }
    let pr = progress ?? statusProgress[s] ?? t.progress;
    if (s === "IN_PROGRESS" && pr === 0) pr = 5;
    if (s === "IN_PROGRESS" && pr >= 100) pr = 95;
    pr = Math.max(0, Math.min(100, Math.round(pr)));
    await db.$transaction(async (tx) => {
      await tx.projectTask.update({ where: { id: taskId }, data: { status: s, progress: pr } });
      await recalcProgress(tx, t.projectId);
      await audit(c, { action: "UPDATE", entityType: "ProjectTask", entityId: taskId, summary: `Task ${t.code}: ${humanize(t.status)} → ${humanize(s)} (${pr}%)` }, tx);
    });
    revalidatePath(`/projects/${t.projectId}`);
    revalidatePath("/projects/tasks");
    return { message: `${humanize(s)}` };
  });
}

export async function addTaskComment(taskId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("tasks:edit");
    const body = z.string().trim().min(1, "Write a comment first").parse(String(fd.get("body") ?? ""));
    const t = await db.projectTask.findFirst({ where: { id: taskId, companyId: c.companyId } });
    if (!t) throw new UserError("Task not found.");
    await getProject(c, t.projectId);
    await db.taskComment.create({ data: { taskId, userId: c.userId, body } });
    if (t.assignedToId && t.assignedToId !== c.userId) await notifyUsers([t.assignedToId], { companyId: c.companyId, type: "GENERAL", title: `New comment on ${t.name}`, body, link: `/projects/${t.projectId}?tab=tasks` });
    revalidatePath(`/projects/${t.projectId}`);
    return { message: "Comment added" };
  });
}

export async function deleteTask(taskId: string) {
  return run(async () => {
    const c = await assertPerm("tasks:delete");
    const t = await db.projectTask.findFirst({ where: { id: taskId, companyId: c.companyId } });
    if (!t) throw new UserError("Task not found.");
    await getProject(c, t.projectId);
    await db.$transaction(async (tx) => {
      await tx.projectTask.updateMany({ where: { dependsOnId: taskId }, data: { dependsOnId: null } });
      await tx.projectTask.delete({ where: { id: taskId } });
      await recalcProgress(tx, t.projectId);
      await audit(c, { action: "DELETE", entityType: "ProjectTask", entityId: taskId, summary: `Deleted task ${t.code} “${t.name}”` }, tx);
    });
    revalidatePath(`/projects/${t.projectId}`);
    return { message: "Task deleted" };
  });
}

// ───────────── MILESTONES ─────────────
const msSchema = z.object({ name: zReqStr("Milestone name is required"), dueDate: zOptDate, billingPct: z.coerce.number({ message: "Enter a percentage" }).min(0).max(100).optional() });

export async function createMilestone(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("projects:edit");
    const d = msSchema.parse(formToObject(fd));
    const p = await getProject(c, projectId);
    const total = await db.projectMilestone.aggregate({ where: { projectId }, _sum: { billingPct: true } });
    if (num(total._sum.billingPct) + (d.billingPct ?? 0) > 100) throw new UserError("Milestone billing percentages can't add up to more than 100%.");
    const m = await db.projectMilestone.create({ data: { companyId: c.companyId, projectId, name: d.name, dueDate: d.dueDate, billingPct: d.billingPct ?? 0 } });
    await audit(c, { action: "CREATE", entityType: "ProjectMilestone", entityId: m.id, summary: `Added milestone “${d.name}” to ${p.code}` });
    revalidatePath(`/projects/${projectId}`);
    return { message: "Milestone added" };
  });
}

export async function updateMilestone(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("projects:edit");
    const d = msSchema.parse(formToObject(fd));
    const m = await db.projectMilestone.findFirst({ where: { id, companyId: c.companyId } });
    if (!m) throw new UserError("Milestone not found.");
    await getProject(c, m.projectId);
    const others = await db.projectMilestone.aggregate({ where: { projectId: m.projectId, id: { not: id } }, _sum: { billingPct: true } });
    if (num(others._sum.billingPct) + (d.billingPct ?? 0) > 100) throw new UserError("Milestone billing percentages can't add up to more than 100%.");
    await db.projectMilestone.update({ where: { id }, data: { name: d.name, dueDate: d.dueDate ?? null, billingPct: d.billingPct ?? 0 } });
    revalidatePath(`/projects/${m.projectId}`);
    return { message: "Milestone updated" };
  });
}

export async function toggleMilestone(id: string) {
  return run(async () => {
    const c = await assertPerm("projects:edit");
    const m = await db.projectMilestone.findFirst({ where: { id, companyId: c.companyId } });
    if (!m) throw new UserError("Milestone not found.");
    const p = await getProject(c, m.projectId);
    const done = !m.completedAt;
    await db.projectMilestone.update({ where: { id }, data: { completedAt: done ? new Date() : null } });
    await audit(c, { action: "UPDATE", entityType: "ProjectMilestone", entityId: id, summary: `Milestone “${m.name}” of ${p.code} ${done ? "completed" : "reopened"}` });
    if (done && num(m.billingPct) > 0) {
      const { notifyRoles } = await import("@/lib/notify");
      await notifyRoles(c.companyId, ["ACCOUNTS"], { type: "PAYMENT_DUE", title: `Milestone reached: ${m.name}`, body: `${p.name} – bill ${num(m.billingPct)}% of the contract value.`, link: `/projects/${m.projectId}?tab=milestones`, dedupeKey: `ms-done:${id}` });
    }
    revalidatePath(`/projects/${m.projectId}`);
    return { message: done ? "Milestone completed" : "Milestone reopened" };
  });
}

export async function deleteMilestone(id: string) {
  return run(async () => {
    const c = await assertPerm("projects:edit");
    const m = await db.projectMilestone.findFirst({ where: { id, companyId: c.companyId } });
    if (!m) throw new UserError("Milestone not found.");
    await getProject(c, m.projectId);
    await db.projectMilestone.delete({ where: { id } });
    revalidatePath(`/projects/${m.projectId}`);
    return { message: "Milestone deleted" };
  });
}

