import "server-only";
import type { ActionSeverity } from "@prisma/client";
import { db, type Tx } from "./db";
import { nextNumber } from "./sequence";
import { notifyUsers } from "./notify";

/**
 * Actions and blockers: one thing to do or fix, one owner, one due date. They can be raised by a person, or by the app
 * itself when it spots a problem (a crew shortage, a late delivery). Raising the same problem twice for the same
 * source does nothing: while one is open, no second one is made.
 */

export type NewAction = {
  companyId: string;
  title: string;
  detail?: string | null;
  severity?: ActionSeverity;
  ownerId: string;
  createdById: string;
  projectId?: string | null;
  dueDate: Date;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceLabel?: string | null;
  link?: string | null;
};

/** Days to fix, by how serious the problem is, when the app raises an action itself. */
export const DEFAULT_DAYS: Record<ActionSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 3, LOW: 7 };

export function dueIn(severity: ActionSeverity, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setUTCHours(23, 59, 0, 0);
  d.setUTCDate(d.getUTCDate() + DEFAULT_DAYS[severity]);
  return d;
}

/** Creates the action and tells the owner. If an open action already exists for the same source, returns that one. */
export async function raiseAction(tx: Tx | typeof db, a: NewAction) {
  if (a.sourceType && a.sourceId) {
    const open = await tx.actionItem.findFirst({ where: { companyId: a.companyId, sourceType: a.sourceType, sourceId: a.sourceId, status: { in: ["OPEN", "IN_PROGRESS"] } } });
    if (open) return { action: open, created: false };
  }
  const number = await nextNumber(tx as Tx, a.companyId, "ACT");
  const action = await tx.actionItem.create({
    data: {
      companyId: a.companyId, number, title: a.title, detail: a.detail ?? null, severity: a.severity ?? "MEDIUM", ownerId: a.ownerId, createdById: a.createdById,
      projectId: a.projectId ?? null, dueDate: a.dueDate, sourceType: a.sourceType ?? null, sourceId: a.sourceId ?? null, sourceLabel: a.sourceLabel ?? null, link: a.link ?? null,
    },
  });
  if (a.ownerId !== a.createdById) {
    await notifyUsers([a.ownerId], { companyId: a.companyId, type: "GENERAL", title: `${action.severity === "CRITICAL" || action.severity === "HIGH" ? "Urgent action" : "New action"}: ${a.title}`, body: `Due ${a.dueDate.toLocaleDateString("en-IN")}`, link: a.link ?? "/actions", dedupeKey: `action:${action.id}:new` }, tx as Tx);
  }
  return { action, created: true };
}

/** Closes every open action raised by a source (for example when the late delivery arrives). */
export async function resolveActionsFor(tx: Tx | typeof db, companyId: string, sourceType: string, sourceId: string, byId: string, resolution: string) {
  await tx.actionItem.updateMany({ where: { companyId, sourceType, sourceId, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: byId, resolution } });
}
