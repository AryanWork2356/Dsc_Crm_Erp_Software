import "server-only";
import { db } from "./db";
import { payables, receivables, monthlyCashFlow, type MonthPoint } from "./finance-stats";
import { projectFinancials } from "./project-finance";
import { getTimeLimitItems, RULES } from "./time-limits";
import { notifyRoles } from "./notify";
import { formatINR, num, round2, startOfDay } from "./utils";
import { istParts } from "./site-reports";

/**
 * The reports the Commercial Director owes the Managing Director (Commercial Director SOP):
 *   weekly  – payables, receivables / collection forecast, cash flow, critical vendor payments, high-risk outstanding
 *   monthly – turnover, profitability, department performance, vendor performance, new vendors, projects closed
 * Built from live records, so nobody compiles them by hand.
 */

const DAY = 86400000;

export type WeeklyReport = {
  asOf: Date;
  payables: { total: number; overdue: number; overdueCount: number; dueThisWeek: number; notCertified: number; notCertifiedAmount: number; byVendor: { name: string; total: number; overdue: number }[] };
  receivables: { total: number; overdue: number; overdueCount: number; dueThisWeek: number; byClient: { name: string; total: number; overdue: number }[] };
  highRisk: { id: string; number: string; client: string; balance: number; daysLate: number }[];
  criticalVendors: { name: string; overdue31plus: number }[];
  cashFlow: MonthPoint[];
  forecast: { in: number; out: number; net: number; note: string };
  overdueByDepartment: { title: string; count: number }[];
};

export async function weeklyReport(companyId: string, now: Date = new Date()): Promise<WeeklyReport> {
  const today = startOfDay(now);
  const week = new Date(today.getTime() + 7 * DAY);
  const [pay, rec, cash, uncertified, tracked] = await Promise.all([
    payables(companyId), receivables(companyId), monthlyCashFlow(companyId, 6),
    db.vendorBill.findMany({ where: { companyId, certRequired: true, certifiedAt: null, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, select: { amount: true, paid: true } }),
    getTimeLimitItems(companyId, now),
  ]);
  const late = (due: Date | null, issue: Date) => (due ?? issue) < today;
  const dueWeek = (due: Date | null, issue: Date) => { const d = due ?? issue; return d >= today && d < week; };

  const payDue = round2(pay.open.filter((b) => dueWeek(b.dueDate, b.billDate)).reduce((s, b) => s + b.balance, 0));
  const recDue = round2(rec.open.filter((i) => dueWeek(i.dueDate, i.issueDate)).reduce((s, i) => s + i.balance, 0));
  const vendorMap = new Map<string, { name: string; total: number; overdue: number }>();
  for (const b of pay.open) {
    const e = vendorMap.get(b.vendorId) ?? { name: b.vendor.name, total: 0, overdue: 0 };
    e.total += b.balance;
    if (late(b.dueDate, b.billDate)) e.overdue += b.balance;
    vendorMap.set(b.vendorId, e);
  }
  const clientMap = new Map<string, { name: string; total: number; overdue: number }>();
  for (const i of rec.open) {
    const e = clientMap.get(i.clientId) ?? { name: i.client.name, total: 0, overdue: 0 };
    e.total += i.balance;
    if (late(i.dueDate, i.issueDate)) e.overdue += i.balance;
    clientMap.set(i.clientId, e);
  }
  const top = (m: Map<string, { name: string; total: number; overdue: number }>) => [...m.values()].map((x) => ({ ...x, total: round2(x.total), overdue: round2(x.overdue) })).sort((a, b) => b.total - a.total).slice(0, 8);

  const highRisk = rec.open
    .map((i) => ({ id: i.id, number: i.number, client: i.client.name, balance: i.balance, daysLate: Math.floor((today.getTime() - (i.dueDate ?? i.issueDate).getTime()) / DAY) }))
    .filter((i) => i.daysLate > 60).sort((a, b) => b.daysLate - a.daysLate).slice(0, 15);
  const criticalVendors = pay.aging.map((r) => ({ name: r.name, overdue31plus: round2(r.buckets["31–60 days"] + r.buckets["61–90 days"] + r.buckets["90+ days"]) })).filter((r) => r.overdue31plus > 0).sort((a, b) => b.overdue31plus - a.overdue31plus).slice(0, 8);

  // simple 7-day forecast: what falls due (plus what is already overdue) on each side
  const inFlow = round2(recDue + rec.overdueTotal);
  const outFlow = round2(payDue + pay.overdueTotal);
  const byRule = new Map<string, number>();
  for (const t of tracked) if (t.state === "overdue") byRule.set(t.ruleKey, (byRule.get(t.ruleKey) ?? 0) + 1);

  return {
    asOf: now,
    payables: { total: pay.total, overdue: pay.overdueTotal, overdueCount: pay.overdueCount, dueThisWeek: payDue, notCertified: uncertified.length, notCertifiedAmount: round2(uncertified.reduce((s, b) => s + num(b.amount) - num(b.paid), 0)), byVendor: top(vendorMap) },
    receivables: { total: rec.total, overdue: rec.overdueTotal, overdueCount: rec.overdueCount, dueThisWeek: recDue, byClient: top(clientMap) },
    highRisk, criticalVendors, cashFlow: cash,
    forecast: { in: inFlow, out: outFlow, net: round2(inFlow - outFlow), note: "Amounts falling due in the next 7 days plus everything already overdue, if all were collected and paid." },
    overdueByDepartment: RULES.map((r) => ({ title: r.title, count: byRule.get(r.key) ?? 0 })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
  };
}

export type MonthlyReport = {
  year: number;
  month: number; // 1-12
  label: string;
  billed: number;
  invoicesIssued: number;
  collected: number;
  profitability: { overallMarginPct: number; contract: number; profit: number; best: { code: string; name: string; marginPct: number; profit: number }[]; worst: { code: string; name: string; marginPct: number; profit: number }[] };
  vendors: { name: string; orders: number; value: number; late: number }[];
  newVendors: string[];
  projectsClosed: { code: string; name: string }[];
  overdueByDepartment: { title: string; count: number }[];
};

export async function monthlyReport(companyId: string, year: number, month: number): Promise<MonthlyReport> {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const [invoices, payments, projects, pos, vendorsNew, closed, tracked] = await Promise.all([
    db.invoice.findMany({ where: { companyId, deletedAt: null, issueDate: { gte: from, lt: to }, status: { in: ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"] } }, select: { subtotal: true, discount: true } }),
    db.payment.aggregate({ where: { companyId, date: { gte: from, lt: to } }, _sum: { amount: true } }),
    db.project.findMany({ where: { companyId, deletedAt: null, status: { in: ["EXECUTION", "QUALITY_CHECK", "SNAGGING", "HANDOVER", "COMPLETED"] } }, select: { id: true, code: true, name: true, contractValue: true } }),
    db.purchaseOrder.findMany({ where: { companyId, orderDate: { gte: from, lt: to }, status: { notIn: ["DRAFT", "CANCELLED"] } }, include: { vendor: { select: { name: true } }, receipts: { select: { deliveryDate: true } } } }),
    db.vendor.findMany({ where: { companyId, createdAt: { gte: from, lt: to }, deletedAt: null }, select: { name: true } }),
    db.projectClosure.findMany({ where: { companyId, closedAt: { gte: from, lt: to } }, include: { project: { select: { code: true, name: true } } } }),
    getTimeLimitItems(companyId),
  ]);
  const fin = await projectFinancials(companyId, projects.map((p) => p.id));
  const scored = projects.map((p) => ({ code: p.code, name: p.name, f: fin.get(p.id)! })).filter((x) => x.f && x.f.contractValue > 0).map((x) => ({ code: x.code, name: x.name, marginPct: round2(x.f.marginPct), profit: round2(x.f.profit), contract: x.f.contractValue }));
  const contract = scored.reduce((s, x) => s + x.contract, 0);
  const profit = scored.reduce((s, x) => s + x.profit, 0);
  const byMargin = [...scored].sort((a, b) => b.marginPct - a.marginPct);

  const vm = new Map<string, { name: string; orders: number; value: number; late: number }>();
  for (const o of pos) {
    const e = vm.get(o.vendorId) ?? { name: o.vendor.name, orders: 0, value: 0, late: 0 };
    e.orders++;
    e.value += num(o.total);
    if (o.deliveryDate && o.receipts.some((r) => r.deliveryDate.getTime() > o.deliveryDate!.getTime() + DAY - 1)) e.late++;
    vm.set(o.vendorId, e);
  }
  const byRule = new Map<string, number>();
  for (const t of tracked) if (t.state === "overdue") byRule.set(t.ruleKey, (byRule.get(t.ruleKey) ?? 0) + 1);

  return {
    year, month, label: from.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
    billed: round2(invoices.reduce((s, i) => s + num(i.subtotal) - num(i.discount), 0)), invoicesIssued: invoices.length, collected: round2(num(payments._sum.amount)),
    profitability: { overallMarginPct: contract ? round2((profit / contract) * 100) : 0, contract: round2(contract), profit: round2(profit), best: byMargin.slice(0, 5), worst: byMargin.slice(-5).reverse() },
    vendors: [...vm.values()].map((v) => ({ ...v, value: round2(v.value) })).sort((a, b) => b.value - a.value).slice(0, 10),
    newVendors: vendorsNew.map((v) => v.name),
    projectsClosed: closed.map((c) => ({ code: c.project.code, name: c.project.name })),
    overdueByDepartment: RULES.map((r) => ({ title: r.title, count: byRule.get(r.key) ?? 0 })).filter((r) => r.count > 0).sort((a, b) => b.count - a.count),
  };
}

/** Monday 08:00 (IST) onwards: the weekly report is announced to the Owner and Management, once per ISO week. */
export async function runWeeklyDigest(companyId: string, now: Date = new Date()): Promise<{ sent: boolean }> {
  const ist = istParts(now);
  const dow = new Date(ist.date + "T00:00:00Z").getUTCDay(); // 1 = Monday
  if (dow !== 1 || ist.minutes < 8 * 60) return { sent: false };
  const r = await weeklyReport(companyId, now);
  await notifyRoles(companyId, ["OWNER", "MANAGEMENT"], {
    type: "GENERAL", title: "Weekly report is ready",
    body: `To collect ${formatINR(r.receivables.total)} (${formatINR(r.receivables.overdue)} overdue) · to pay ${formatINR(r.payables.total)} (${formatINR(r.payables.overdue)} overdue) · 7-day net ${formatINR(r.forecast.net)}`,
    link: "/director-reports", dedupeKey: `weekly-digest:${ist.date}`,
  });
  return { sent: true };
}
