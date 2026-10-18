import type { ReportKind } from "@prisma/client";
import { calendarDay } from "./utils";

/** Site-report timing. All clock maths is in IST (the company works in India) regardless of the server's timezone. */

export type ReportTimes = { reportMorningDue: string; reportMorningDueOutstation: string; reportEveningDue: string };
export const DEFAULT_TIMES: ReportTimes = { reportMorningDue: "10:00", reportMorningDueOutstation: "09:30", reportEveningDue: "19:00" };

const IST_OFFSET_MIN = 330;

/** The IST calendar date ("YYYY-MM-DD") and minutes-since-midnight for a moment. */
export function istParts(now: Date = new Date()): { date: string; minutes: number } {
  const t = new Date(now.getTime() + IST_OFFSET_MIN * 60000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** @db.Date key for today's IST date. */
export function reportDay(now: Date = new Date()): Date {
  return calendarDay(istParts(now).date);
}

export function parseHHmm(v: string, fallback: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v?.trim() ?? "") ?? /^(\d{1,2}):(\d{2})$/.exec(fallback)!;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

export function dueMinutes(kind: ReportKind, outstation: boolean, t: ReportTimes = DEFAULT_TIMES): number {
  if (kind === "EVENING") return parseHHmm(t.reportEveningDue, DEFAULT_TIMES.reportEveningDue);
  return outstation ? parseHHmm(t.reportMorningDueOutstation, DEFAULT_TIMES.reportMorningDueOutstation) : parseHHmm(t.reportMorningDue, DEFAULT_TIMES.reportMorningDue);
}

export function dueLabel(kind: ReportKind, outstation: boolean, t: ReportTimes = DEFAULT_TIMES): string {
  const m = dueMinutes(kind, outstation, t);
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Was a report for `forDate` submitted at `at` on time? A report filed on a later day is always late. */
export function isOnTime(kind: ReportKind, outstation: boolean, forDate: Date, at: Date, t: ReportTimes = DEFAULT_TIMES): boolean {
  const p = istParts(at);
  const day = forDate.toISOString().slice(0, 10);
  if (p.date > day) return false;
  if (p.date < day) return true;
  return p.minutes <= dueMinutes(kind, outstation, t);
}

export type SlotState = "done" | "waiting" | "due_soon" | "overdue";

/** State of today's slot for the board: green done / grey waiting / amber due within 60 min / red overdue. */
export function slotState(kind: ReportKind, outstation: boolean, submitted: boolean, now: Date = new Date(), t: ReportTimes = DEFAULT_TIMES): SlotState {
  if (submitted) return "done";
  const due = dueMinutes(kind, outstation, t);
  const m = istParts(now).minutes;
  if (m > due) return "overdue";
  if (due - m <= 60) return "due_soon";
  return "waiting";
}

/** Minutes past the deadline (0 if not yet late). */
export function minutesLate(kind: ReportKind, outstation: boolean, now: Date = new Date(), t: ReportTimes = DEFAULT_TIMES): number {
  return Math.max(0, istParts(now).minutes - dueMinutes(kind, outstation, t));
}

export const MATERIAL_STATUS_LABEL = { OK: "All material available", SHORT_SOON: "Shortage soon", WORK_STOPPED: "Work stopped – no material" } as const;
