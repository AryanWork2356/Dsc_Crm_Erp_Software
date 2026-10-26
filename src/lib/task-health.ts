/**
 * One written rule for the status shown next to a task, so everyone reads it the same way.
 *
 *  Complete   : finished.
 *  Blocked    : somebody marked it blocked (a reason and an action should exist).
 *  Delayed    : not finished and its due date has passed.
 *  At risk    : not finished and any of: due within 2 days with under 80% done; its start date has passed but it has not
 *               started; the task it waits for is not finished and is due after this task is meant to start.
 *  On track   : none of the above.
 */

export type Health = "COMPLETE" | "BLOCKED" | "DELAYED" | "AT_RISK" | "ON_TRACK";

export const HEALTH_LABEL: Record<Health, string> = { COMPLETE: "Complete", BLOCKED: "Blocked", DELAYED: "Delayed", AT_RISK: "At risk", ON_TRACK: "On track" };

type T = { status: string; dueDate: Date | null; startDate: Date | null; progress: number; dependsOn?: { status: string; dueDate: Date | null } | null };

const DAY = 86400000;

export function taskHealth(t: T, today: Date): Health {
  if (t.status === "COMPLETED") return "COMPLETE";
  if (t.status === "BLOCKED") return "BLOCKED";
  if (t.dueDate && t.dueDate.getTime() < today.getTime()) return "DELAYED";
  if (t.dueDate && t.dueDate.getTime() - today.getTime() <= 2 * DAY && t.progress < 80) return "AT_RISK";
  if (t.startDate && t.startDate.getTime() < today.getTime() && t.status === "TODO") return "AT_RISK";
  const dep = t.dependsOn;
  if (dep && dep.status !== "COMPLETED" && dep.dueDate && t.startDate && dep.dueDate.getTime() > t.startDate.getTime()) return "AT_RISK";
  return "ON_TRACK";
}
