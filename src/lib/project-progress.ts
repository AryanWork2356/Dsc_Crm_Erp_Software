import type { Tx } from "./db";

const DAY = 86400000;

/**
 * Project progress = progress of its tasks, each counted by how many days it runs (a 10-day carpentry job weighs ten times a 1-day
 * cleaning job). A task without dates counts as one day.
 */
export function weightedProgress(tasks: { progress: number; startDate: Date | null; dueDate: Date | null }[]): number | null {
  if (!tasks.length) return null;
  let sum = 0, weight = 0;
  for (const t of tasks) {
    const s = t.startDate ?? t.dueDate, e = t.dueDate ?? t.startDate;
    const w = s && e ? Math.max(1, Math.round((e.getTime() - s.getTime()) / DAY) + 1) : 1;
    sum += t.progress * w; weight += w;
  }
  return Math.round(sum / weight);
}

export async function recalcProgress(tx: Tx, projectId: string) {
  const tasks = await tx.projectTask.findMany({ where: { projectId }, select: { progress: true, startDate: true, dueDate: true } });
  const p = weightedProgress(tasks);
  if (p !== null) await tx.project.update({ where: { id: projectId }, data: { progress: p } });
}
