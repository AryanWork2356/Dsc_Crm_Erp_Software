/** Standard defect-liability period after handover. Matches the default quotation terms (12 months). */
export const WARRANTY_MONTHS = 12;

export function warrantyUntil(project: { actualEndDate: Date | null; status: string }): Date | null {
  if (!project.actualEndDate) return null;
  const d = new Date(project.actualEndDate);
  d.setMonth(d.getMonth() + WARRANTY_MONTHS);
  return d;
}

export function inWarranty(project: { actualEndDate: Date | null; status: string }, on = new Date()): boolean {
  if (project.status !== "COMPLETED" && project.status !== "HANDOVER") return false;
  const until = warrantyUntil(project);
  return !!until && on <= until;
}
