import "server-only";
import type { Ctx } from "./auth";
import { db } from "./db";
import { projectScope } from "./scope";
import { projectFinancials } from "./project-finance";
import { ACTIVE } from "./exceptions";
import { num, startOfDay } from "./utils";

/**
 * Management numbers. Every figure is computed from real records when the page is opened (nothing is stored or typed in),
 * and each one has a written definition and the count it is based on. A number with too little behind it says so
 * instead of showing a percentage. The "target" lines are DSC's to approve: they are the app's suggestion, not a rule.
 *
 * Window: the last 90 days unless the definition says otherwise.
 */

export const WINDOW_DAYS = 90;
export const MIN_SAMPLE = 5; // below this many records a percentage is not shown

export type Kpi = {
  key: string;
  label: string;
  value: string; // what is shown ("82 %", "₹4.2 L", "—")
  basis: string; // "based on 17 milestones"
  definition: string;
  target?: string; // suggested, needs company approval
  tone: "good" | "warn" | "bad" | "none";
  link?: string;
};

const DAY = 86400000;
const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);
const fmtPct = (v: number | null, sample: number) => (v == null || sample < MIN_SAMPLE ? "—" : `${v.toFixed(0)} %`);
const rupees = (v: number) => (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
/** higher is better */
const toneHigh = (v: number | null, sample: number, good: number, bad: number): Kpi["tone"] => (v == null || sample < MIN_SAMPLE ? "none" : v >= good ? "good" : v >= bad ? "warn" : "bad");

export async function kpiReport(c: Ctx, now: Date = new Date()): Promise<{ generatedAt: Date; kpis: Kpi[]; notYet: { label: string; why: string }[] }> {
  const today = startOfDay(now);
  const from = new Date(today.getTime() - WINDOW_DAYS * DAY);
  const projects = await db.project.findMany({ where: projectScope(c), select: { id: true, status: true, budget: true, contractValue: true } });
  const ids = projects.map((p) => p.id);
  const active = projects.filter((p) => (ACTIVE as readonly string[]).includes(p.status));
  const kpis: Kpi[] = [];

  // 1. milestones on time
  const ms = await db.projectMilestone.findMany({ where: { projectId: { in: ids }, dueDate: { gte: from, lt: new Date(today.getTime() + DAY) } }, select: { dueDate: true, completedAt: true } });
  const msOnTime = ms.filter((m) => m.completedAt && m.completedAt.getTime() <= m.dueDate!.getTime() + DAY - 1).length;
  const msV = pct(msOnTime, ms.length);
  kpis.push({ key: "milestones", label: "Milestones finished on time", value: fmtPct(msV, ms.length), basis: `${msOnTime} of ${ms.length} milestones that fell due in the last ${WINDOW_DAYS} days`, definition: "Milestones whose date fell in the last 90 days and that were completed on or before that date, divided by all milestones whose date fell in the period. A milestone finished late, or not finished, counts as not on time.", target: "Suggested: 80 % or more", tone: toneHigh(msV, ms.length, 80, 60), link: "/exceptions" });

  // 2. plan reliability: finished tasks against the FIRST committed date
  const tasks = await db.projectTask.findMany({ where: { projectId: { in: ids }, status: "COMPLETED", updatedAt: { gte: from }, OR: [{ baselineDue: { not: null } }, { dueDate: { not: null } }] }, select: { updatedAt: true, dueDate: true, baselineDue: true } });
  const taskOk = tasks.filter((t) => (t.baselineDue ?? t.dueDate) && t.updatedAt.getTime() <= (t.baselineDue ?? t.dueDate)!.getTime() + DAY - 1).length;
  const tv = pct(taskOk, tasks.length);
  kpis.push({ key: "plan", label: "Plan reliability", value: fmtPct(tv, tasks.length), basis: `${taskOk} of ${tasks.length} tasks finished in the last ${WINDOW_DAYS} days`, definition: "Tasks marked complete in the last 90 days (the date it was marked complete is taken from the task's last update) that were finished on or before their FIRST committed due date (not the date after it was moved), divided by all tasks completed in the period. Moving a date does not improve this number.", target: "Suggested: 75 % or more", tone: toneHigh(tv, tasks.length, 75, 50), link: "/projects" });

  // 3. material readiness: lines whose need-by day has come, and are fully delivered
  const lines = await db.purchaseOrderItem.findMany({ where: { po: { companyId: c.companyId, projectId: { in: ids }, status: { in: ["APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] } } }, select: { quantity: true, receivedQty: true, needBy: true, po: { select: { deliveryDate: true } } } });
  const due = lines.map((l) => ({ ...l, day: l.needBy ?? l.po.deliveryDate })).filter((l) => l.day && l.day.getTime() < today.getTime() + DAY && l.day.getTime() >= from.getTime());
  const ready = due.filter((l) => num(l.receivedQty) + 1e-9 >= num(l.quantity)).length;
  const rv = pct(ready, due.length);
  kpis.push({ key: "materials", label: "Material ready when needed", value: fmtPct(rv, due.length), basis: `${ready} of ${due.length} order lines whose need-by day has come`, definition: "Purchase-order lines whose need-by day (or the order's delivery date) fell in the last 90 days up to today, and that have been delivered in full, divided by all such lines. It looks at the position today, so it does not say whether delivery was on the day.", target: "Suggested: 90 % or more", tone: toneHigh(rv, due.length, 90, 70), link: "/procurement/deliveries" });

  // 4. crew availability
  const logs = await db.manpowerLog.findMany({ where: { companyId: c.companyId, projectId: { in: ids }, date: { gte: from } }, select: { planned: true, present: true, late: true } });
  const planned = logs.reduce((s, l) => s + l.planned, 0);
  const came = logs.reduce((s, l) => s + Math.min(l.present, l.planned), 0);
  const av = pct(came, planned);
  kpis.push({ key: "crew", label: "Crew who came as planned", value: fmtPct(av, logs.length), basis: `${came} of ${planned} planned person-days over ${logs.length} recorded day${logs.length === 1 ? "" : "s"}`, definition: "Person-days that came, divided by person-days planned, from the daily manpower records of the last 90 days (extra people beyond the plan are not counted). Days nobody recorded are not counted either.", target: "Suggested: 90 % or more", tone: toneHigh(av, logs.length, 90, 75), link: "/resources" });

  // 5. extra work done without approval
  const extra = await db.additionalWork.findMany({ where: { projectId: { in: ids }, kind: { in: ["CHARGEABLE", "EMERGENCY"] }, status: { in: ["IN_PROGRESS", "COMPLETED"] }, decidedAt: null }, select: { amount: true } });
  kpis.push({ key: "unapproved", label: "Extra work without the client's approval", value: String(extra.length), basis: c.can("finance:view") ? `worth ${rupees(extra.reduce((s, w) => s + num(w.amount), 0))}` : "open items", definition: "Chargeable or emergency extra work that has started or finished but has no client decision on record. Should be 0.", target: "Suggested: 0", tone: extra.length === 0 ? "good" : "bad", link: "/extra-work" });

  if (c.can("margins:view") || c.can("finance:view")) {
    // 6. forecast variance
    const fin = await projectFinancials(c.companyId, active.map((p) => p.id));
    const withBudget = [...fin.values()].filter((f) => f.budget > 0);
    const over = withBudget.filter((f) => f.forecastOverBudget);
    const loss = [...fin.values()].filter((f) => f.forecastLoss);
    const totalVar = withBudget.reduce((s, f) => s + Math.max(0, f.forecastVariance), 0);
    kpis.push({ key: "forecast", label: "Projects forecast over budget", value: withBudget.length ? `${over.length} of ${withBudget.length}` : "—", basis: withBudget.length ? `total overrun ${rupees(totalVar)}; ${loss.length} forecast a loss` : `${active.length - withBudget.length} active project(s) have no budget`, definition: "Active projects with a budget whose forecast final cost (booked cost + undelivered open orders + the project manager's estimate still to spend) is above the budget. A project with no budget cannot be measured and is not counted.", target: "Suggested: none over budget; none forecast a loss", tone: withBudget.length === 0 ? "none" : loss.length ? "bad" : over.length ? "warn" : "good", link: "/exceptions" });
  }

  if (c.can("finance:view")) {
    // 7. billing turnaround: finished billing milestone → invoice created
    const done = await db.projectMilestone.findMany({ where: { projectId: { in: ids }, completedAt: { gte: from }, billingPct: { gt: 0 } }, select: { name: true, projectId: true, completedAt: true } });
    const invItems = done.length ? await db.invoiceItem.findMany({ where: { invoice: { projectId: { in: ids }, status: { not: "CANCELLED" }, deletedAt: null }, OR: done.map((m) => ({ description: { startsWith: `${m.name} –` }, invoice: { projectId: m.projectId } })) }, select: { description: true, invoice: { select: { projectId: true, createdAt: true } } } }) : [];
    const gaps: number[] = [];
    let waiting = 0;
    for (const m of done) {
      const it = invItems.find((x) => x.invoice.projectId === m.projectId && x.description.startsWith(`${m.name} –`));
      if (it) gaps.push(Math.max(0, (it.invoice.createdAt.getTime() - m.completedAt!.getTime()) / DAY));
      else waiting++;
    }
    const avg = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
    kpis.push({ key: "billing", label: "Days from milestone done to invoice", value: avg != null && gaps.length >= 3 ? `${avg.toFixed(1)} days` : "—", basis: `${gaps.length} invoiced, ${waiting} finished billing milestone(s) still not invoiced`, definition: "For billing milestones completed in the last 90 days: the average number of days between the milestone being marked complete and the invoice for it being created. Milestones not yet invoiced are counted separately, not averaged in.", target: "Suggested: 3 days or less", tone: waiting > 0 ? "warn" : avg == null || gaps.length < 3 ? "none" : avg <= 3 ? "good" : avg <= 7 ? "warn" : "bad", link: "/finance/invoices" });

    // 8. overdue receivables
    const open = await db.invoice.findMany({ where: { companyId: c.companyId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } }, select: { total: true, paid: true, dueDate: true } });
    const owed = open.reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paid)), 0);
    const overdue = open.filter((i) => i.dueDate && i.dueDate < today).reduce((s, i) => s + Math.max(0, num(i.total) - num(i.paid)), 0);
    const ov = pct(overdue, owed);
    kpis.push({ key: "receivables", label: "Receivables past their due date", value: owed > 0 ? `${rupees(overdue)}` : "₹0", basis: owed > 0 ? `${(ov ?? 0).toFixed(0)} % of the ${rupees(owed)} still to collect` : "nothing outstanding", definition: "Money still to collect on invoices whose due date has passed, and its share of all money still to collect. Whole company, not limited to your projects.", target: "Suggested: under 20 % of outstanding", tone: owed === 0 ? "good" : (ov ?? 0) < 20 ? "good" : (ov ?? 0) < 40 ? "warn" : "bad", link: "/finance/receivables" });
  }

  return {
    generatedAt: now,
    kpis,
    notYet: [
      { label: "Lead conversion", why: "The sales pipeline is hidden until DSC has a dedicated sales team." },
      { label: "Client satisfaction", why: "No client rating is recorded anywhere in the app yet." },
    ],
  };
}
