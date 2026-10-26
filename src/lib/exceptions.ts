import "server-only";
import type { Ctx } from "./auth";
import { db } from "./db";
import { projectScope } from "./scope";
import { projectFinancials } from "./project-finance";
import { getTimeLimitItems } from "./time-limits";
import { slippedDays } from "./baseline";
import { num, startOfDay } from "./utils";

/**
 * What management needs to look at today. Every list is computed from the real records on request (nothing is stored,
 * nothing is sample data) and every row links to the record behind it. The definitions are printed on the page.
 *
 *  active project      : status Planning … Handover (not Completed, On hold or Cancelled)
 *  no owner            : no project manager chosen
 *  no budget           : project budget is 0 AND no BOQ with an estimated cost
 *  no schedule         : no planned completion date
 *  no recent update    : in execution, quality check or snagging with no daily report in the last 3 days
 *  late milestone      : a milestone past its date and not done
 *  moved date          : planned completion (or a task due date) later than the first committed date
 *  overdue receivable  : an invoice past its due date with money still to collect
 */

export const ACTIVE = ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"] as const;
const RUNNING = ["EXECUTION", "QUALITY_CHECK", "SNAGGING"] as const;
export const STALE_DAYS = 3;

export type Row = { id: string; title: string; detail?: string; link: string };
export type Section = { key: string; title: string; hint: string; rows: Row[]; tone: "bad" | "warn" };

export type ExceptionReport = {
  generatedAt: Date;
  activeProjects: number;
  sections: Section[];
  totals: { exceptions: number; projectsWithProblems: number };
};

const proj = (p: { id: string; code: string; name: string }) => ({ id: p.id, title: `${p.code} · ${p.name}`, link: `/projects/${p.id}` });
const dayLabel = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

export async function exceptionReport(c: Ctx, now: Date = new Date()): Promise<ExceptionReport> {
  const today = startOfDay(now);
  const scope = projectScope(c);
  const projects = await db.project.findMany({
    where: { AND: [scope, { status: { in: [...ACTIVE] } }] },
    select: { id: true, code: true, name: true, status: true, projectManagerId: true, plannedEndDate: true, baselineEndDate: true, budget: true },
    orderBy: { code: "asc" },
    take: 500,
  });
  const ids = projects.map((p) => p.id);
  const sections: Section[] = [];
  const add = (s: Section) => { if (s.rows.length) sections.push(s); };

  // projects missing the basics
  const fin = await projectFinancials(c.companyId, ids);
  add({ key: "no_owner", title: "Projects with no project manager", hint: "Nobody is accountable. Open the project and choose a project manager.", tone: "bad", rows: projects.filter((p) => !p.projectManagerId).map(proj) });
  add({ key: "no_budget", title: "Projects with no budget", hint: "Cost cannot be compared with a plan. Set the budget or approve a BOQ with costs.", tone: "warn", rows: projects.filter((p) => (fin.get(p.id)?.budget ?? num(p.budget)) <= 0).map(proj) });
  add({ key: "no_schedule", title: "Projects with no planned completion date", hint: "Without a date nothing can be late. Set it (the first date becomes the baseline).", tone: "warn", rows: projects.filter((p) => !p.plannedEndDate).map(proj) });

  // quiet sites
  const since = new Date(today.getTime() - STALE_DAYS * 86400000);
  const reports = await db.dailyReport.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, reportDate: { gte: since } }, _count: true });
  const reported = new Set(reports.map((r) => r.projectId));
  add({ key: "no_update", title: `Sites with no daily report for ${STALE_DAYS} days`, hint: "The site is running but nobody has reported. Ask the supervisor.", tone: "bad", rows: projects.filter((p) => (RUNNING as readonly string[]).includes(p.status) && !reported.has(p.id)).map(proj) });

  // dates
  add({
    key: "past_end", title: "Projects past their planned completion", hint: "Still open after the planned date.", tone: "bad",
    rows: projects.filter((p) => p.plannedEndDate && p.plannedEndDate < today).map((p) => ({ ...proj(p), detail: `was due ${dayLabel(p.plannedEndDate!)}${slippedDays(p.baselineEndDate, p.plannedEndDate) ? `, already moved +${slippedDays(p.baselineEndDate, p.plannedEndDate)} days from the first date` : ""}` })),
  });
  add({
    key: "moved_end", title: "Projects whose completion date was moved", hint: "The first committed date is kept. Check the reason with the project manager.", tone: "warn",
    rows: projects.filter((p) => slippedDays(p.baselineEndDate, p.plannedEndDate) > 0 && !(p.plannedEndDate && p.plannedEndDate < today)).map((p) => ({ ...proj(p), detail: `first date ${dayLabel(p.baselineEndDate!)} → now ${dayLabel(p.plannedEndDate!)} (+${slippedDays(p.baselineEndDate, p.plannedEndDate)} days)` })),
  });
  const milestones = await db.projectMilestone.findMany({ where: { projectId: { in: ids }, completedAt: null, dueDate: { lt: today } }, select: { id: true, name: true, dueDate: true, projectId: true }, orderBy: { dueDate: "asc" }, take: 200 });
  const code = new Map(projects.map((p) => [p.id, p.code]));
  add({ key: "late_milestone", title: "Milestones past their date", hint: "A milestone is not marked done and its date has passed.", tone: "bad", rows: milestones.map((m) => ({ id: m.id, title: `${code.get(m.projectId)} · ${m.name}`, detail: `due ${dayLabel(m.dueDate!)}`, link: `/projects/${m.projectId}?tab=milestones` })) });
  const tasks = await db.projectTask.findMany({ where: { projectId: { in: ids }, status: { not: "COMPLETED" }, baselineDue: { not: null }, dueDate: { not: null } }, select: { id: true, code: true, name: true, dueDate: true, baselineDue: true, projectId: true }, take: 1000 });
  add({
    key: "moved_task", title: "Tasks whose due date was moved", hint: "Compare the first date with the new one.", tone: "warn",
    rows: tasks.filter((t) => slippedDays(t.baselineDue, t.dueDate) > 0).sort((a, b) => slippedDays(b.baselineDue, b.dueDate) - slippedDays(a.baselineDue, a.dueDate)).slice(0, 100).map((t) => ({ id: t.id, title: `${code.get(t.projectId)} · ${t.code} ${t.name}`, detail: `+${slippedDays(t.baselineDue, t.dueDate)} days (first ${dayLabel(t.baselineDue!)})`, link: `/projects/${t.projectId}?tab=tasks` })),
  });

  // people and decisions
  const items = await getTimeLimitItems(c.companyId, now);
  const mine = (i: { projectId: string | null }) => !i.projectId || ids.includes(i.projectId) || ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role);
  const late = items.filter((i) => i.state === "overdue" && mine(i));
  add({ key: "approvals", title: "Approvals waiting too long", hint: "Someone is waiting for a decision past the time limit.", tone: "bad", rows: late.filter((i) => i.ruleKey === "approvals").map((i) => ({ id: i.id, title: i.title, detail: i.detail, link: i.link })) });
  const openActions = await db.actionItem.findMany({
    where: {
      companyId: c.companyId, status: { in: ["OPEN", "IN_PROGRESS"] },
      AND: [{ OR: [{ severity: { in: ["HIGH", "CRITICAL"] } }, { dueDate: { lt: today } }] }, ["OWNER", "MANAGEMENT", "ADMIN"].includes(c.role) ? {} : { OR: [{ ownerId: c.userId }, { projectId: { in: ids } }] }],
    },
    orderBy: { dueDate: "asc" }, take: 100,
  });
  add({ key: "actions", title: "Serious or late actions", hint: "High or critical actions, and anything past its date.", tone: "bad", rows: openActions.map((a) => ({ id: a.id, title: `${a.number} ${a.title}`, detail: `${a.severity.toLowerCase()} · due ${dayLabel(a.dueDate)}`, link: "/actions?view=open" })) });
  add({ key: "other_late", title: "Other items past their time limit", hint: "Everything else on the Time Limits board that is late.", tone: "warn", rows: late.filter((i) => !["approvals", "action_overdue"].includes(i.ruleKey)).slice(0, 60).map((i) => ({ id: `${i.ruleKey}:${i.id}`, title: i.title, detail: i.rule.title, link: i.link })) });

  // variations
  const emergencies = await db.additionalWork.findMany({ where: { projectId: { in: ids }, kind: "EMERGENCY", decidedAt: null, status: { in: ["IN_PROGRESS", "COMPLETED"] } }, select: { id: true, number: true, title: true, projectId: true }, take: 50 });
  add({ key: "emergency", title: "Emergency work without the client's written approval", hint: "It was done as an emergency. Get the client's approval on record before billing.", tone: "bad", rows: emergencies.map((w) => ({ id: w.id, title: `${code.get(w.projectId)} · ${w.number} ${w.title}`, link: "/extra-work" })) });

  // money (only for people allowed to see it)
  if (c.can("finance:view")) {
    const unbilled = await db.additionalWork.findMany({ where: { projectId: { in: ids }, kind: { in: ["CHARGEABLE", "EMERGENCY"] }, status: "COMPLETED", billedInvoiceId: null }, select: { id: true, number: true, title: true, projectId: true, amount: true, completedAt: true }, take: 50 });
    add({ key: "unbilled_extra", title: "Finished extra work not yet on an invoice", hint: "Work was done and approved but nobody has billed it.", tone: "warn", rows: unbilled.map((w) => ({ id: w.id, title: `${code.get(w.projectId)} · ${w.number} ${w.title}`, detail: `₹${num(w.amount).toLocaleString("en-IN")}${w.completedAt ? `, finished ${dayLabel(w.completedAt)}` : ""}`, link: "/extra-work" })) });
    const inv = await db.invoice.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, dueDate: { lt: today } }, include: { client: { select: { name: true } } }, orderBy: { dueDate: "asc" }, take: 100 });
    add({ key: "receivables", title: "Client invoices past their due date", hint: "Money to collect. Follow up and record the next action.", tone: "bad", rows: inv.filter((i) => num(i.total) - num(i.paid) > 0.5).map((i) => ({ id: i.id, title: `${i.number} · ${i.client.name}`, detail: `₹${(num(i.total) - num(i.paid)).toLocaleString("en-IN")} due ${dayLabel(i.dueDate!)}`, link: `/finance/invoices/${i.id}` })) });
    const bills = await db.vendorBill.findMany({ where: { companyId: c.companyId, status: { in: ["UNPAID", "PARTIALLY_PAID"] }, certRequired: true, certifiedAt: null }, include: { vendor: { select: { name: true } } }, orderBy: { billDate: "asc" }, take: 100 });
    add({ key: "bills", title: "Vendor bills waiting to be certified", hint: "The project manager must certify the work before accounts can pay.", tone: "warn", rows: bills.map((b) => ({ id: b.id, title: `${b.number} · ${b.vendor.name}`, detail: `₹${num(b.amount).toLocaleString("en-IN")} billed ${dayLabel(b.billDate)}`, link: "/bills-to-certify" })) });
  }

  const withProblems = new Set<string>();
  for (const s of sections) if (["no_owner", "no_budget", "no_schedule", "no_update", "past_end", "moved_end"].includes(s.key)) for (const r of s.rows) withProblems.add(r.id);
  return { generatedAt: now, activeProjects: projects.length, sections, totals: { exceptions: sections.reduce((n, s) => n + s.rows.length, 0), projectsWithProblems: withProblems.size } };
}
