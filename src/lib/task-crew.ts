import "server-only";
import type { Tx } from "./db";
import { resolveActionsFor } from "./action-items";

/**
 * The schedule is the one place where the crew is planned: a task with a trade and "people needed" IS a crew need on the Manpower page
 * (where the vendor confirms it). The need follows the task's dates, trade and people, and goes when the task goes. Confirmations kept.
 */
type TaskCrew = { id: string; companyId: string; projectId: string; name: string; requiredTrade: string | null; requiredHeadcount: number | null; startDate: Date | null; dueDate: Date | null };

export async function syncTaskCrew(tx: Tx, t: TaskCrew, byId: string) {
  const need = await tx.resourceNeed.findFirst({ where: { taskId: t.id } });
  const from = t.startDate ?? t.dueDate, to = t.dueDate ?? t.startDate;
  const trade = t.requiredTrade?.trim();
  if (!trade || !t.requiredHeadcount || !from || !to) {
    if (need) await removeTaskCrew(tx, t.companyId, t.id, byId);
    return;
  }
  const data = { trade, fromDate: from, toDate: to, required: t.requiredHeadcount, note: `From the schedule: ${t.name}`.slice(0, 500) };
  if (need) await tx.resourceNeed.update({ where: { id: need.id }, data });
  else await tx.resourceNeed.create({ data: { ...data, companyId: t.companyId, projectId: t.projectId, taskId: t.id, createdById: byId } });
}

export async function removeTaskCrew(tx: Tx, companyId: string, taskId: string, byId: string) {
  const needs = await tx.resourceNeed.findMany({ where: { taskId }, select: { id: true } });
  for (const n of needs) await resolveActionsFor(tx, companyId, "ResourceNeed", n.id, byId, "The scheduled work was removed.");
  await tx.resourceNeed.deleteMany({ where: { taskId } });
}
