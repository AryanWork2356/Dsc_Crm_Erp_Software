import type { Tx } from "./db";
import type { Ctx } from "./auth";
import { UserError } from "./action";
import { audit } from "./audit";

/**
 * Committed dates keep their history. The first date a project end or a task due date is given becomes its BASELINE and
 * never changes. Any later change needs a reason and is logged (who, when, old, new, why), so a missed date can never be
 * quietly moved to hide a delay.
 */

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export type DateChangeInput = {
  entityType: "Project" | "ProjectTask";
  entityId: string;
  projectId: string;
  field: string; // "plannedEndDate" | "dueDate"
  label: string; // what to call it in messages, e.g. "Planned completion"
  oldDate: Date | null;
  newDate: Date | null;
  baseline: Date | null;
  reason?: string | null;
};

/**
 * Decides the baseline to store and records the change when one is needed.
 * Returns the baseline value to write (or null if there is none yet). Throws a UserError when a reason is missing.
 */
export async function applyDateChange(tx: Tx, c: Ctx, r: DateChangeInput): Promise<{ baseline: Date | null }> {
  const same = day(r.oldDate) === day(r.newDate);
  if (same) return { baseline: r.baseline ?? r.oldDate }; // freeze an old value the first time we see it
  if (!r.oldDate) return { baseline: r.baseline ?? r.newDate }; // the first commitment: nothing to explain
  const reason = (r.reason ?? "").trim();
  if (reason.length < 3) throw new UserError(`${r.label} is already committed. Write why it is changing; the reason is recorded.`);
  const baseline = r.baseline ?? r.oldDate;
  await tx.dateChange.create({
    data: { companyId: c.companyId, entityType: r.entityType, entityId: r.entityId, projectId: r.projectId, field: r.field, oldDate: r.oldDate, newDate: r.newDate, reason, changedById: c.userId },
  });
  await audit(c, { action: "UPDATE", entityType: r.entityType, entityId: r.entityId, summary: `${c.name} moved ${r.label} from ${day(r.oldDate)} to ${day(r.newDate) ?? "no date"}: ${reason}` }, tx);
  return { baseline };
}

/** Whole days a date has slipped past its baseline (0 if none or no baseline). */
export function slippedDays(baseline: Date | null | undefined, current: Date | null | undefined): number {
  if (!baseline || !current) return 0;
  return Math.max(0, Math.round((current.getTime() - baseline.getTime()) / 86400000));
}
