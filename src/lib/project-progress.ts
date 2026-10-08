import type { Tx } from "./db";

/** Project progress = average progress of its tasks (when it has tasks). */
export async function recalcProgress(tx: Tx, projectId: string) {
  const agg = await tx.projectTask.aggregate({ where: { projectId }, _avg: { progress: true }, _count: true });
  if (agg._count > 0) await tx.project.update({ where: { id: projectId }, data: { progress: Math.round(agg._avg.progress ?? 0) } });
}
