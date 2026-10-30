import "server-only";
import type { ChecklistKind, Feasibility, ChecklistItem } from "@prisma/client";
import { db, type Tx } from "./db";

/**
 * Before DSC accepts a job: can it really be done (scope, money, people, vendors, materials, factory, schedule, risk)?
 * After it is awarded: the first three days of getting ready. Both are checklists whose items need an owner, a date
 * and, to be marked confirmed, a written note saying who confirmed what (so nothing is "confirmed" just because a name was typed).
 * The number of days and the extra days for out-of-city jobs are company defaults here, not laws: change them in this file.
 */

export const FEASIBILITY_ITEMS = [
  { key: "scope", label: "Scope", question: "Are drawings, BOQ, specifications, exclusions and client expectations clear?" },
  { key: "commercial", label: "Commercial", question: "What is the expected margin, payment schedule and cash requirement?" },
  { key: "manpower", label: "Manpower", question: "How many workers of each skill are needed, and when?" },
  { key: "vendors", label: "Vendors", question: "Are capacity, rates, coordinator and backup vendors confirmed?" },
  { key: "materials", label: "Materials", question: "What is in stock, what must be bought, and when will it arrive?" },
  { key: "factory", label: "Factory", question: "Can production, machines and dispatch meet the dates?" },
  { key: "schedule", label: "Schedule", question: "Are dependencies, site access, travel and handovers realistic?" },
  { key: "risk", label: "Risk", question: "What could delay the job, and what is the recovery plan?" },
] as const;

/** Day 0 is the day the job is handed over. Out-of-city jobs get extra days on every step after Day 0. */
export const LAUNCH_ITEMS = [
  { key: "d0_handover", day: 0, label: "Hand over scope, BOQ, drawings, quote and client promises", question: "Estimation hands the complete file to the project manager." },
  { key: "d0_owner", day: 0, label: "Project manager named", question: "One person is accountable for this project." },
  { key: "d1_tasks", day: 1, label: "Work broken into tasks and zones", question: "Tasks, zones, dependencies and quantities are entered." },
  { key: "d1_needs", day: 1, label: "Manpower and materials estimated", question: "Headcount by trade and the materials list with need-by dates." },
  { key: "d1_schedule", day: 1, label: "Schedule created", question: "Milestones and the completion date are set (this becomes the baseline)." },
  { key: "d2_vendors", day: 2, label: "Vendor headcount and backup confirmed", question: "Each vendor has confirmed numbers, with a backup named." },
  { key: "d2_materials", day: 2, label: "Stock checked and purchase orders placed", question: "Reserved from stock, or ordered with a promised arrival date." },
  { key: "d2_factory", day: 2, label: "Factory capacity and logistics confirmed", question: "Production slots and transport are booked." },
  { key: "d3_site", day: 3, label: "Site ready", question: "Site access, drawings and approvals are in place." },
  { key: "d3_people", day: 3, label: "Critical people and first deliveries confirmed", question: "Coordinator, workers and first-week material are confirmed." },
  { key: "d3_week", day: 3, label: "First-week plan agreed", question: "Daily plan for the first week is written and shared." },
] as const;

export const OUTSTATION_EXTRA_DAYS = 2;

export function launchDue(day0: Date, day: number, outstation: boolean): Date {
  const d = new Date(day0);
  d.setUTCHours(23, 59, 0, 0);
  d.setUTCDate(d.getUTCDate() + day + (outstation && day > 0 ? OUTSTATION_EXTRA_DAYS : 0));
  return d;
}

export type Full = Feasibility & { items: ChecklistItem[] };

async function addMissing(tx: Tx | typeof db, f: Feasibility, kind: ChecklistKind, outstation: boolean, day0: Date) {
  const have = new Set((await tx.checklistItem.findMany({ where: { feasibilityId: f.id, kind }, select: { key: true } })).map((i) => i.key));
  const wanted = kind === "FEASIBILITY"
    ? FEASIBILITY_ITEMS.map((i, n) => ({ key: i.key, label: i.label, question: i.question, sortOrder: n, dueDate: null as Date | null }))
    : LAUNCH_ITEMS.map((i, n) => ({ key: i.key, label: i.label, question: i.question, sortOrder: n, dueDate: launchDue(day0, i.day, outstation) as Date | null }));
  const rows = wanted.filter((w) => !have.has(w.key));
  if (rows.length) await tx.checklistItem.createMany({ data: rows.map((w) => ({ ...w, feasibilityId: f.id, kind })) });
}

/** The feasibility record of a quotation (the capacity check before accepting), created with its eight questions. */
export async function feasibilityForQuotation(companyId: string, quotationId: string): Promise<Full> {
  let f = await db.feasibility.findUnique({ where: { quotationId } });
  if (!f) f = await db.feasibility.create({ data: { companyId, quotationId } });
  await addMissing(db, f, "FEASIBILITY", false, new Date());
  return db.feasibility.findUniqueOrThrow({ where: { id: f.id }, include: { items: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] } } });
}

/**
 * The feasibility record of a project: the one made for its quotation (carried over when the job was awarded), or a new
 * one; it also holds the launch checklist, whose Day 0 is the day the project was created.
 */
export async function feasibilityForProject(companyId: string, projectId: string): Promise<Full> {
  const p = await db.project.findFirstOrThrow({ where: { id: projectId, companyId }, select: { id: true, createdAt: true, outstation: true, quotationId: true } });
  let f = await db.feasibility.findUnique({ where: { projectId } });
  if (!f && p.quotationId) {
    const fromQuote = await db.feasibility.findUnique({ where: { quotationId: p.quotationId } });
    if (fromQuote && !fromQuote.projectId) f = await db.feasibility.update({ where: { id: fromQuote.id }, data: { projectId } });
  }
  if (!f) f = await db.feasibility.create({ data: { companyId, projectId, quotationId: null } });
  await addMissing(db, f, "FEASIBILITY", p.outstation, p.createdAt);
  await addMissing(db, f, "LAUNCH", p.outstation, p.createdAt);
  return db.feasibility.findUniqueOrThrow({ where: { id: f.id }, include: { items: { orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] } } });
}

export const isOpen = (i: { status: string }) => i.status === "PENDING" || i.status === "AT_RISK";
