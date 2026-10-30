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
import { removeTaskCrew, syncTaskCrew } from "@/lib/task-crew";
import { reportDay } from "@/lib/site-reports";
import { ensureClosure } from "@/lib/closure";
import { formToObject, zNumPos, zOptDate, zOptStr, zReqStr } from "@/lib/form";
import { humanize, num } from "@/lib/utils";
import { applyDateChange } from "@/lib/baseline";
import { dueIn, raiseAction, resolveActionsFor } from "@/lib/action-items";
import { readScheduleFile } from "@/lib/schedule-file";
import { parseMaterialNeeds, parseSchedule, pastedRows, type Raw } from "@/lib/schedule-import";

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
  outstation: z.boolean().default(false),
  contractValue: zNumPos().default(0),
  budget: zNumPos().default(0),
  dateChangeReason: zOptStr, // required when an already-committed date is changed
});

function checkDates(d: { startDate?: Date; plannedEndDate?: Date }) {
  if (d.startDate && d.plannedEndDate && d.plannedEndDate < d.startDate) throw new UserError("Planned completion can't be before the start date.");
}

async function syncMembers(tx: Tx, projectId: string, d: z.infer<typeof projectSchema>) {
  const wanted: [string | undefined, string][] = [[d.projectManagerId, "Project Manager"], [d.designerId, "Designer"], [d.siteEngineerId, "Site Engineer"], [d.supervisorId, "Project Coordinator"]];
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
      const { dateChangeReason: _why, ...rest } = d;
      const x = await tx.project.create({ data: { ...rest, baselineEndDate: d.plannedEndDate ?? null, companyId: c.companyId, code, status: "PLANNING" } });
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
      const end = await applyDateChange(tx, c, { entityType: "Project", entityId: id, projectId: id, field: "plannedEndDate", label: "Planned completion", oldDate: old.plannedEndDate, newDate: d.plannedEndDate ?? old.plannedEndDate, baseline: old.baselineEndDate, reason: d.dateChangeReason });
      await tx.project.update({ where: { id }, data: { name: d.name, clientId: d.clientId, segment: d.segment, siteAddress: d.siteAddress, startDate: d.startDate, plannedEndDate: d.plannedEndDate, baselineEndDate: end.baseline, projectManagerId: d.projectManagerId ?? null, designerId: d.designerId ?? null, siteEngineerId: d.siteEngineerId ?? old.siteEngineerId ?? null, supervisorId: d.supervisorId ?? null, outstation: d.outstation, ...money } });
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

/** What is still to be spent on a project beyond what is booked and what is on order. Needs access to costs. */
export async function setEstimateToComplete(id: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("projects:edit");
    if (!c.can("margins:view")) throw new UserError("You don't have access to project costs.");
    const d = z.object({ amount: zNumPos("Enter 0 or more"), note: zOptStr }).parse(formToObject(fd));
    const old = await getProject(c, id);
    await db.project.update({ where: { id }, data: { estimateToComplete: d.amount, estimateNote: d.note ?? null, estimateUpdatedAt: new Date(), estimateUpdatedById: c.userId } });
    await audit(c, { action: "UPDATE", entityType: "Project", entityId: id, summary: `${c.name} changed the estimate still to spend on ${old.code} from ₹${num(old.estimateToComplete).toLocaleString("en-IN")} to ₹${d.amount.toLocaleString("en-IN")}${d.note ? `: ${d.note}` : ""}`, oldValue: { estimateToComplete: num(old.estimateToComplete) }, newValue: { estimateToComplete: d.amount } });
    revalidatePath(`/projects/${id}`);
    return { message: "Saved: the forecast is updated" };
  });
}

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
      if (s === "HANDOVER" || s === "COMPLETED") await ensureClosure(tx, c.companyId, id); // SOP: closure checklist starts at handover
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
  zone: zOptStr,
  plannedQty: z.coerce.number().min(0).max(1e9).optional(),
  actualQty: z.coerce.number().min(0).max(1e9).optional(),
  qtyUnit: zOptStr,
  requiredTrade: zOptStr,
  requiredHeadcount: z.coerce.number().int().min(0).max(500).optional(),
  blockedReason: zOptStr,
  zoneReleased: z.boolean().default(false),
  dateChangeReason: zOptStr, // required when an already-committed due date is changed
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
      const { dateChangeReason: _why, ...rest } = d;
      const x = await tx.projectTask.create({ data: { ...rest, releasedAt: d.zoneReleased ? new Date() : null, baselineDue: d.dueDate ?? null, companyId: c.companyId, projectId, code } });
      await syncTaskCrew(tx, x, c.userId);
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

/**
 * Adds a whole schedule from an Excel (or CSV) file: one task per row, with its area, trade, people, dates (or day numbers from the project
 * start), quantity and what it depends on. Everything is checked first; one wrong row means NOTHING is added, and the message names the row.
 */
export async function importSchedule(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("tasks:create");
    const p = await getProject(c, projectId);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose the schedule file (Excel or CSV).");
    return addSchedule(c, p, await readScheduleFile(file), fd.get("addToExisting") === "on");
  });
}

/** The same, from rows copied in Excel and pasted into the app (the first pasted row must be the column names). */
export async function pasteSchedule(projectId: string, fd: FormData) {
  return run(async () => {
    const c = await assertPerm("tasks:create");
    const p = await getProject(c, projectId);
    const work = pastedRows(String(fd.get("work") ?? "")), materials = pastedRows(String(fd.get("materials") ?? ""));
    if (!work.length && !materials.length) throw new UserError("Paste the rows from Excel, with the row of column names on top.");
    return addSchedule(c, p, { work, materials }, fd.get("addToExisting") === "on");
  });
}

async function addSchedule(c: Ctx, p: Awaited<ReturnType<typeof getProject>>, sheets: { work: Raw[]; materials: Raw[] }, addToExisting: boolean) {
    const projectId = p.id;
    const [existing, existingNeeds] = await Promise.all([db.projectTask.count({ where: { projectId } }), db.materialNeed.count({ where: { projectId } })]);
    if (existing + existingNeeds > 0 && !addToExisting) throw new UserError(`This project already has ${existing} task${existing === 1 ? "" : "s"} and ${existingNeeds} material line${existingNeeds === 1 ? "" : "s"}. Tick “Add these to what is already there” if you want the file added as well.`);
    if (!sheets.work.length && !sheets.materials.length) throw new UserError("The file has no rows. Use the template: the first sheet is the work, and a sheet called Materials is the material it needs.");
    const work = sheets.work.length ? parseSchedule(sheets.work, p.startDate) : { tasks: [], errors: [] };
    const mats = parseMaterialNeeds(sheets.materials, p.startDate, work.tasks);
    const errors = [...work.errors.map((e) => ({ ...e, sheet: "work" })), ...mats.errors.map((e) => ({ ...e, sheet: "materials" }))];
    if (errors.length) {
      const shown = errors.slice(0, 8).map((e) => (e.sheet === "materials" ? e.message : e.row ? `row ${e.row}: ${e.message}` : e.message)).join(" · ");
      throw new UserError(`Nothing was added. Please fix this and upload again: ${shown}${errors.length > 8 ? ` · and ${errors.length - 8} more` : ""}`);
    }
    // "Assigned to": a person with a login, by name or email (workers with a login too)
    const people = work.tasks.some((t) => t.assignee) ? await db.user.findMany({ where: { companyId: c.companyId, isActive: true, deletedAt: null, role: { notIn: ["CLIENT", "VENDOR"] } }, select: { id: true, name: true, email: true, workerId: true } }) : [];
    const who = (n: string) => { const k = n.trim().toLowerCase(); const hit = people.filter((u) => u.email.toLowerCase() === k || u.name.trim().toLowerCase() === k); return hit.length === 1 ? hit[0] : null; };
    const unknown = work.tasks.filter((t) => t.assignee && !who(t.assignee));
    if (unknown.length) throw new UserError(`Nothing was added. Please fix this and upload again: ${unknown.slice(0, 6).map((t) => `row ${t.row}: nobody called “${t.assignee}” has a login (use the name or email exactly as in the app, or leave it empty)`).join(" · ")}`);
    const catalogue = mats.lines.length ? await db.material.findMany({ where: { companyId: c.companyId, deletedAt: null }, select: { id: true, name: true, unit: true } }) : [];
    await db.$transaction(async (tx) => {
      const ids = new Map<string, string>(); // Sl No and name of each task, to link "Depends on" and "For work"
      for (const t of work.tasks) {
        const code = await nextNumber(tx, c.companyId, "TSK");
        const dep = t.dependsOn ? ids.get(t.dependsOn.toLowerCase()) : undefined;
        const x = await tx.projectTask.create({
          data: { companyId: c.companyId, projectId, code, name: t.name, description: t.details ?? null, priority: t.priority, startDate: t.start ?? null, dueDate: t.due ?? null, baselineDue: t.due ?? null,
            zone: t.zone ?? null, requiredTrade: t.trade ?? null, requiredHeadcount: t.headcount ?? null, plannedQty: t.qty ?? null, qtyUnit: t.unit ?? null, dependsOnId: dep ?? null,
            ...(t.assignee ? { assignedToId: who(t.assignee)!.id, workerId: who(t.assignee)!.workerId ?? null } : {}) },
        });
        ids.set(t.sl.toLowerCase(), x.id); ids.set(t.name.toLowerCase(), x.id);
        await syncTaskCrew(tx, x, c.userId); // its trade and people become the crew need on the Manpower page
      }
      for (const m of mats.lines) {
        const cat = catalogue.find((x) => x.name.toLowerCase() === m.description.toLowerCase());
        const taskId = m.forWork ? (ids.get(m.forWork.toLowerCase()) ?? null) : null;
        await tx.materialNeed.create({ data: { companyId: c.companyId, projectId, materialId: cat?.id ?? null, description: cat?.name ?? m.description, unit: m.unit ?? cat?.unit ?? "nos", quantity: m.qty, neededBy: m.neededBy, taskId, forWork: m.forWork ?? null, note: m.note ?? null, createdById: c.userId } });
      }
      if (work.tasks.length) await recalcProgress(tx, projectId);
      await audit(c, { action: "CREATE", entityType: "ProjectTask", entityId: projectId, summary: `Uploaded a schedule of ${work.tasks.length} tasks and ${mats.lines.length} material lines to ${p.code}` }, tx);
    }, { timeout: 60_000, maxWait: 10_000 });
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/projects/tasks");
    revalidatePath("/procurement/needs");
    return { message: `${work.tasks.length} tasks and ${mats.lines.length} material lines added to the schedule` };
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
      const { dateChangeReason, ...rest } = d;
      const due = await applyDateChange(tx, c, { entityType: "ProjectTask", entityId: taskId, projectId: t.projectId, field: "dueDate", label: `Due date of ${t.code}`, oldDate: t.dueDate, newDate: d.dueDate ?? t.dueDate, baseline: t.baselineDue, reason: dateChangeReason });
      const x = await tx.projectTask.update({ where: { id: taskId }, data: { ...rest, releasedAt: d.zoneReleased ? (t.releasedAt ?? new Date()) : null, baselineDue: due.baseline, assignedToId: d.assignedToId ?? null, workerId: d.workerId ?? null, dependsOnId: d.dependsOnId ?? null } });
      await syncTaskCrew(tx, x, c.userId);
      await recalcProgress(tx, t.projectId);
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
      if (s === "BLOCKED" && t.status !== "BLOCKED") {
        const proj = await tx.project.findUnique({ where: { id: t.projectId }, select: { projectManagerId: true, code: true } });
        const owner = proj?.projectManagerId ?? t.assignedToId ?? c.userId;
        await raiseAction(tx, { companyId: c.companyId, title: `${proj?.code}: ${t.name} is blocked`, severity: "HIGH", ownerId: owner, createdById: c.userId, projectId: t.projectId, dueDate: dueIn("HIGH"), detail: t.blockedReason ?? "No reason written yet. Open the task and say what is blocking it.", sourceType: "ProjectTask", sourceId: t.id, sourceLabel: `task ${t.code}`, link: `/projects/${t.projectId}?tab=tasks` });
      } else if (t.status === "BLOCKED" && s !== "BLOCKED") {
        await resolveActionsFor(tx, c.companyId, "ProjectTask", t.id, c.userId, `Task moved to ${humanize(s)}.`);
      }
      await audit(c, { action: "UPDATE", entityType: "ProjectTask", entityId: taskId, summary: `Task ${t.code}: ${humanize(t.status)} → ${humanize(s)} (${pr}%)` }, tx);
    });
    revalidatePath(`/projects/${t.projectId}`);
    revalidatePath("/projects/tasks");
    return { message: `${humanize(s)}` };
  });
}

/**
 * Start work today that the schedule has for a later day (the site is free early, the material came early). Its start moves to today;
 * the finish date stays, so no reason is asked. The task it depends on must be finished first, as always.
 */
export async function startTaskToday(taskId: string) {
  return run(async () => {
    const c = await assertPerm("tasks:edit");
    const t = await db.projectTask.findFirst({ where: { id: taskId, companyId: c.companyId } });
    if (!t) throw new UserError("Task not found.");
    await getProject(c, t.projectId);
    if (t.status === "COMPLETED") throw new UserError("This work is already finished.");
    if (t.dependsOnId) {
      const dep = await db.projectTask.findUnique({ where: { id: t.dependsOnId } });
      if (dep && dep.status !== "COMPLETED") throw new UserError(`Finish “${dep.name}” first – this work depends on it.`);
    }
    const today = reportDay();
    await db.$transaction(async (tx) => {
      const x = await tx.projectTask.update({ where: { id: taskId }, data: { startDate: today, ...(t.dueDate && t.dueDate < today ? { dueDate: today } : {}), status: "IN_PROGRESS", progress: Math.max(t.progress, 5) } });
      await syncTaskCrew(tx, x, c.userId);
      await recalcProgress(tx, t.projectId);
      await audit(c, { action: "UPDATE", entityType: "ProjectTask", entityId: taskId, summary: `Task ${t.code} started early, today${t.startDate ? ` (planned ${t.startDate.toISOString().slice(0, 10)})` : ""}` }, tx);
    });
    revalidatePath("/today");
    revalidatePath(`/projects/${t.projectId}`);
    return { message: `${t.name} starts today` };
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
      await removeTaskCrew(tx, c.companyId, taskId, c.userId);
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

