import "server-only";
import { db } from "./db";
import { monthlyCashFlow, payables, receivables } from "./finance-stats";
import { projectFinancials } from "./project-finance";
import { calendarDay, num, round2, startOfDay } from "./utils";

/**
 * Executive dashboard numbers. Everything is computed live from the database for a chosen period;
 * "snapshot" figures (receivables, stock, active projects) always reflect the present, period figures
 * (revenue, expenses, new leads…) reflect the selected date range.
 */

export type Period = "today" | "week" | "month" | "quarter" | "year" | "custom";
export const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" }, { key: "year", label: "This year" }, { key: "custom", label: "Custom" },
];

export function resolvePeriod(p: string | undefined, from?: string, to?: string): { key: Period; from: Date; to: Date; label: string } {
  const now = new Date();
  const sod = startOfDay(now);
  const key = (PERIODS.some((x) => x.key === p) ? p : "month") as Period;
  let f = new Date(now.getFullYear(), now.getMonth(), 1);
  let t = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (key === "today") { f = sod; t = new Date(sod.getTime() + 86400000); }
  else if (key === "week") { const dow = (sod.getDay() + 6) % 7; f = new Date(sod.getTime() - dow * 86400000); t = new Date(f.getTime() + 7 * 86400000); }
  else if (key === "quarter") { const q = Math.floor(now.getMonth() / 3) * 3; f = new Date(now.getFullYear(), q, 1); t = new Date(now.getFullYear(), q + 3, 1); }
  else if (key === "year") { f = new Date(now.getFullYear(), 0, 1); t = new Date(now.getFullYear() + 1, 0, 1); }
  else if (key === "custom" && from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    f = new Date(from + "T00:00:00"); t = new Date(new Date(to + "T00:00:00").getTime() + 86400000);
    if (t <= f) t = new Date(f.getTime() + 86400000);
  }
  return { key, from: f, to: t, label: PERIODS.find((x) => x.key === key)!.label };
}

const ACTIVE = ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT", "EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER"] as const;

export async function executiveStats(companyId: string, from: Date, to: Date) {
  const today = startOfDay();
  const [
    activeProjects, completed, delayed, startingSoon, leadsPeriod, leadsNew, wonPeriod, leadStages, leadSources,
    pendingQuotes, quoteValue, approvedQuoteValue, pendingApprovals, posPending, inventory, workers, presentToday, staff, rec, pay, flow, lowStock, projectsAll,
  ] = await Promise.all([
    db.project.count({ where: { companyId, deletedAt: null, status: { in: [...ACTIVE] } } }),
    db.project.count({ where: { companyId, deletedAt: null, status: "COMPLETED" } }),
    db.project.count({ where: { companyId, deletedAt: null, status: { in: [...ACTIVE] }, plannedEndDate: { lt: today } } }),
    db.project.count({ where: { companyId, deletedAt: null, status: { in: ["PLANNING", "DESIGN", "QUOTATION", "APPROVED", "PROCUREMENT"] }, startDate: { gte: today, lt: new Date(today.getTime() + 15 * 86400000) } } }),
    db.lead.count({ where: { companyId, deletedAt: null, createdAt: { gte: from, lt: to } } }),
    db.lead.count({ where: { companyId, deletedAt: null, stage: "NEW" } }),
    db.lead.count({ where: { companyId, deletedAt: null, stage: "WON", updatedAt: { gte: from, lt: to } } }),
    db.lead.groupBy({ by: ["stage"], where: { companyId, deletedAt: null }, _count: true }),
    db.lead.groupBy({ by: ["source"], where: { companyId, deletedAt: null, createdAt: { gte: from, lt: to } }, _count: true }),
    db.quotation.count({ where: { companyId, deletedAt: null, status: "PENDING_APPROVAL" } }),
    db.quotation.aggregate({ where: { companyId, deletedAt: null, date: { gte: from, lt: to } }, _sum: { total: true } }),
    db.quotation.aggregate({ where: { companyId, deletedAt: null, status: { in: ["APPROVED", "SENT", "VIEWED", "NEGOTIATION", "ACCEPTED"] }, date: { gte: from, lt: to } }, _sum: { total: true } }),
    db.approval.count({ where: { companyId, status: "PENDING" } }),
    db.purchaseOrder.count({ where: { companyId, status: { in: ["PENDING_APPROVAL", "APPROVED", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED"] } } }),
    db.stockBalance.findMany({ where: { companyId, quantity: { gt: 0 } }, select: { quantity: true, avgCost: true } }),
    db.worker.count({ where: { companyId, deletedAt: null, isActive: true } }),
    db.attendance.count({ where: { companyId, date: calendarDay(), workerId: { not: null }, status: { in: ["PRESENT", "OVERTIME", "HALF_DAY"] } } }),
    db.employee.count({ where: { companyId, deletedAt: null, status: { not: "EXITED" } } }),
    receivables(companyId),
    payables(companyId),
    monthlyCashFlow(companyId, 6),
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Material" m WHERE m."companyId" = ${companyId} AND m."deletedAt" IS NULL AND m."reorderLevel" > 0 AND COALESCE((SELECT SUM(b.quantity) FROM "StockBalance" b JOIN "Warehouse" w ON w.id = b."locationId" WHERE b."materialId" = m.id AND w.type = 'WAREHOUSE'), 0) <= m."reorderLevel"`,
    db.project.findMany({ where: { companyId, deletedAt: null, status: { not: "CANCELLED" } }, select: { id: true, code: true, name: true, status: true, contractValue: true, progress: true, plannedEndDate: true } }),
  ]);

  const fin = await projectFinancials(companyId, projectsAll.map((p) => p.id));
  const ranked = projectsAll.map((p) => ({ ...p, f: fin.get(p.id)! })).filter((p) => p.f);

  // period revenue/expenses
  const [rev, spent] = await Promise.all([
    db.payment.aggregate({ where: { companyId, date: { gte: from, lt: to } }, _sum: { amount: true } }),
    monthlyCashFlow(companyId, 1, from, to),
  ]);
  const expensesPeriod = spent.reduce((s, m) => s + m.expenses, 0);
  const revenue = num(rev._sum.amount);
  const totalLeads = leadStages.reduce((s, x) => s + x._count, 0);
  const won = leadStages.find((x) => x.stage === "WON")?._count ?? 0;

  const vendorSpend = await db.$queryRaw<{ name: string; v: number }[]>`SELECT v.name, SUM(p.amount)::float AS v FROM "VendorPayment" p JOIN "Vendor" v ON v.id = p."vendorId" WHERE p."companyId" = ${companyId} AND p.date >= ${from} AND p.date < ${to} GROUP BY v.name ORDER BY v DESC LIMIT 6`;
  const materialSpend = await db.$queryRaw<{ name: string; v: number }[]>`SELECT m.category::text AS name, SUM(i.quantity * i."unitCost")::float AS v FROM "InventoryTransaction" i JOIN "Material" m ON m.id = i."materialId" WHERE i."companyId" = ${companyId} AND i.type = 'INWARD' AND i."createdAt" >= ${from} AND i."createdAt" < ${to} GROUP BY m.category ORDER BY v DESC LIMIT 6`;

  return {
    activeProjects, completed, delayed, startingSoon,
    totalLeads, leadsPeriod, leadsNew, wonPeriod, conversion: totalLeads ? round2((won / totalLeads) * 100) : 0,
    funnel: leadStages.map((x) => ({ name: x.stage, value: x._count })), sources: leadSources.map((x) => ({ name: x.source ?? "Unknown", value: x._count })),
    pendingQuotes, quoteValue: num(quoteValue._sum.total), approvedQuoteValue: num(approvedQuoteValue._sum.total),
    pendingApprovals, posPending, lowStock: Number(lowStock[0]?.n ?? 0),
    inventoryValue: round2(inventory.reduce((s, b) => s + num(b.quantity) * num(b.avgCost), 0)),
    workers, presentToday, staff,
    receivable: rec.total, receivableOverdue: rec.overdueTotal, receivableOverdueCount: rec.overdueCount, payable: pay.total, payableOverdue: pay.overdueTotal,
    revenue, expenses: round2(expensesPeriod), grossProfit: round2(revenue - expensesPeriod),
    flow, vendorSpend: vendorSpend.map((v) => ({ name: v.name, value: v.v })), materialSpend: materialSpend.map((m) => ({ name: m.name, value: m.v })),
    projectStatus: Object.entries(projectsAll.reduce<Record<string, number>>((a, p) => ({ ...a, [p.status]: (a[p.status] ?? 0) + 1 }), {})).map(([name, value]) => ({ name, value })),
    profitability: ranked.filter((p) => p.f.actualCost > 0 || num(p.contractValue) > 0).sort((a, b) => num(b.contractValue) - num(a.contractValue)).slice(0, 8).map((p) => ({ id: p.id, code: p.code, name: p.name, contract: num(p.contractValue), cost: p.f.actualCost, profit: p.f.profit, margin: p.f.marginPct, over: p.f.overBudget })),
    overBudget: ranked.filter((p) => p.f.overBudget).map((p) => ({ id: p.id, code: p.code, name: p.name, pct: p.f.variancePct })),
    receivablesOpen: rec.open.slice(0, 5),
  };
}
