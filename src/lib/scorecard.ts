import "server-only";
import type { ProjectReview } from "@prisma/client";
import { db } from "./db";
import { projectFinancials } from "./project-finance";
import { istParts } from "./site-reports";
import { loadClosure } from "./closure";

/**
 * Project performance scorecard – the DSC "Performance" evaluation form, filled from real records wherever possible.
 * Facts (dates, reports, deliveries, budget, documents) are measured; judgement calls (client rating, rework, snags,
 * labour discipline, wastage, safety) come from the review a manager records. Unknown = neutral, and the card is
 * marked "provisional" until a review exists.
 */

export type Metrics = {
  plannedEnd: Date | null;
  endRef: Date; // actual end, or today while the project is still running
  onTime: boolean | null;
  delayDays: number;
  reportDays: number; // working days that needed reports
  reportsExpected: number;
  reportsSent: number;
  reportsOnTime: number;
  posWithDate: number;
  posLate: number;
  budgetVariancePct: number | null; // positive = over budget
  closurePct: number | null; // 0..1
  uncertifiedBills: number;
};

export type ReviewInput = Pick<ProjectReview, "clientRating" | "delayReason" | "delayInControl" | "reworkRequired" | "snagClosedOnTime" | "labourDiscipline" | "wastageControlled" | "safetyFollowed" | "remarks"> | null;

export type Part = { key: string; label: string; points: number; max: number; detail: string };
export type Score = { total: number; label: "Excellent" | "Good" | "Average" | "Needs improvement"; parts: Part[]; provisional: boolean };

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Pure scoring – 100 points. */
export function scoreProject(m: Metrics, review: ReviewInput): Score {
  const parts: Part[] = [];
  const add = (key: string, label: string, max: number, points: number, detail: string) => parts.push({ key, label, max, points: r1(Math.max(0, Math.min(max, points))), detail });

  // 1. Completed on time (25)
  if (m.onTime === null) add("time", "Completed on time", 25, 25, "No planned end date was set");
  else if (m.onTime) add("time", "Completed on time", 25, 25, "Within the planned date");
  else add("time", "Completed on time", 25, 25 * (1 - m.delayDays / 30), `${m.delayDays} day(s) late${review?.delayInControl === false ? " (outside the team's control)" : ""}`);
  // a delay the team did not cause is not held against them
  if (m.onTime === false && review?.delayInControl === false) parts[parts.length - 1].points = 25;

  // 2. Reporting discipline (15): reports sent and on time
  if (m.reportsExpected === 0) add("reports", "Daily reports and site photos", 15, 7.5, "No reporting period yet");
  else {
    const sent = Math.min(1, m.reportsSent / m.reportsExpected);
    const timely = m.reportsSent ? Math.min(1, m.reportsOnTime / m.reportsSent) : 0;
    add("reports", "Daily reports and site photos", 15, 15 * (0.7 * sent + 0.3 * timely), `${m.reportsSent} of ${m.reportsExpected} reports sent, ${m.reportsOnTime} on time`);
  }

  // 3. Quality (15)
  if (!review) add("quality", "Quality, rework and snags", 15, 7.5, "Not reviewed yet");
  else add("quality", "Quality, rework and snags", 15, (review.reworkRequired ? 0 : 8) + (review.snagClosedOnTime ? 7 : 0), `${review.reworkRequired ? "Rework was needed" : "No rework"}; snags ${review.snagClosedOnTime ? "closed on time" : "closed late"}`);

  // 4. Material (10): deliveries on time (5) + wastage (5)
  const delivery = m.posWithDate ? 5 * (1 - m.posLate / m.posWithDate) : 2.5;
  add("material", "Material on time, wastage controlled", 10, delivery + (review ? (review.wastageControlled ? 5 : 0) : 2.5), `${m.posWithDate ? `${m.posWithDate - m.posLate} of ${m.posWithDate} deliveries on time` : "No dated purchase orders"}${review ? `; wastage ${review.wastageControlled ? "controlled" : "not controlled"}` : ""}`);

  // 5. Cost control (10)
  if (m.budgetVariancePct === null) add("cost", "Within budget", 10, 5, "No budget to compare");
  else add("cost", "Within budget", 10, m.budgetVariancePct <= 0 ? 10 : 10 * (1 - m.budgetVariancePct / 15), m.budgetVariancePct <= 0 ? "At or under budget" : `${m.budgetVariancePct.toFixed(1)}% over budget`);

  // 6. Client satisfaction (10)
  if (review?.clientRating) add("client", "Client satisfaction", 10, (10 * review.clientRating) / 5, `${review.clientRating} out of 5`);
  else add("client", "Client satisfaction", 10, 5, "No client rating yet");

  // 7. Documentation (10): closure checklist
  if (m.closurePct === null) add("docs", "Documents submitted", 10, 5, "Closure checklist not started");
  else add("docs", "Documents submitted", 10, 10 * m.closurePct, `${Math.round(m.closurePct * 100)}% of the closure checklist is complete`);

  // 8. Labour and safety (5)
  if (!review) add("safety", "Labour discipline and safety", 5, 2.5, "Not reviewed yet");
  else add("safety", "Labour discipline and safety", 5, (review.safetyFollowed ? 3 : 0) + (review.labourDiscipline ? 2 : 0), `Safety ${review.safetyFollowed ? "followed" : "not followed"}; labour discipline ${review.labourDiscipline ? "good" : "poor"}`);

  const total = r1(parts.reduce((s, p) => s + p.points, 0));
  return { total, label: total >= 85 ? "Excellent" : total >= 70 ? "Good" : total >= 55 ? "Average" : "Needs improvement", parts, provisional: !review };
}

/** Working days (Mon–Sat, India time) from `from` to `to`, inclusive. */
export function workingDays(from: Date, to: Date): number {
  const start = new Date(istParts(from).date + "T00:00:00Z").getTime();
  const end = new Date(istParts(to).date + "T00:00:00Z").getTime();
  let n = 0;
  for (let t = start; t <= end; t += 86400000) if (new Date(t).getUTCDay() !== 0) n++;
  return n;
}

export async function projectMetrics(companyId: string, projectId: string, now: Date = new Date()): Promise<Metrics & { review: ProjectReview | null }> {
  const p = await db.project.findFirstOrThrow({ where: { id: projectId, companyId } });
  const [reports, pos, fin, closure, uncertified, review] = await Promise.all([
    db.dailyReport.findMany({ where: { companyId, projectId }, select: { reportDate: true, onTime: true } }),
    db.purchaseOrder.findMany({ where: { companyId, projectId, deliveryDate: { not: null }, status: { in: ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"] } }, include: { receipts: { select: { deliveryDate: true } } } }),
    projectFinancials(companyId, [projectId]).then((m) => m.get(projectId)),
    loadClosure(companyId, projectId),
    db.vendorBill.count({ where: { companyId, projectId, certRequired: true, certifiedAt: null, status: { not: "CANCELLED" } } }),
    db.projectReview.findUnique({ where: { projectId } }),
  ]);
  const endRef = p.actualEndDate ?? now;
  const onTime = p.plannedEndDate ? endRef <= new Date(p.plannedEndDate.getTime() + 86400000 - 1) : null;
  const delayDays = p.plannedEndDate && !onTime ? Math.ceil((endRef.getTime() - p.plannedEndDate.getTime()) / 86400000) : 0;

  const first = reports.length ? reports.reduce((a, r) => (r.reportDate < a ? r.reportDate : a), reports[0].reportDate) : null;
  const periodStart = p.startDate ?? first;
  const reportDays = periodStart && periodStart <= endRef ? workingDays(periodStart, endRef) : 0;
  const late = pos.filter((o) => o.receipts.some((r) => r.deliveryDate.getTime() > o.deliveryDate!.getTime() + 86400000 - 1)).length;

  return {
    plannedEnd: p.plannedEndDate, endRef, onTime, delayDays,
    reportDays, reportsExpected: reportDays * 2, reportsSent: reports.length, reportsOnTime: reports.filter((r) => r.onTime).length,
    posWithDate: pos.length, posLate: late,
    budgetVariancePct: fin && fin.budget > 0 ? fin.variancePct : null,
    closurePct: closure ? closure.done / closure.total : null,
    uncertifiedBills: uncertified,
    review,
  };
}

export const bandTone = (label: Score["label"]) => (label === "Excellent" ? "green" : label === "Good" ? "blue" : label === "Average" ? "amber" : "red") as "green" | "blue" | "amber" | "red";
