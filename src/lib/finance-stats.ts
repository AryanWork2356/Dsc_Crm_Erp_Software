import "server-only";
import { db } from "./db";
import { buildAging, type AgingRow } from "./aging";
import { num, round2, startOfDay } from "./utils";

/**
 * Company-level money numbers, defined once so every screen agrees.
 *
 *   Income   (cash)  = client payments received
 *   Expenses (cash)  = vendor payments + approved expenses + contractor payments + worker wages (attendance) + net payslips
 *   Receivable       = unpaid balance on issued invoices
 *   Payable          = unpaid balance on vendor bills
 */

export type MonthPoint = { key: string; name: string; income: number; expenses: number };

const MONTH = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

export async function monthlyCashFlow(companyId: string, months = 6, from?: Date, to?: Date): Promise<MonthPoint[]> {
  const now = new Date();
  const start = from ?? new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const end = to ?? new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const rows = await db.$queryRaw<{ m: Date; k: string; v: number }[]>`
    SELECT date_trunc('month', d) AS m, k, SUM(v)::float AS v FROM (
      SELECT "date" AS d, 'in' AS k, amount AS v FROM "Payment" WHERE "companyId" = ${companyId}
      UNION ALL SELECT "date", 'out', amount FROM "VendorPayment" WHERE "companyId" = ${companyId}
      UNION ALL SELECT "date", 'out', amount FROM "Expense" WHERE "companyId" = ${companyId} AND approved = true
      UNION ALL SELECT "date", 'out', amount FROM "ContractorPayment" WHERE "companyId" = ${companyId}
      UNION ALL SELECT "date", 'out', "wageCost" FROM "Attendance" WHERE "companyId" = ${companyId} AND "workerId" IS NOT NULL
      UNION ALL SELECT make_date(year, month, 1), 'out', "netSalary" FROM "Payslip" WHERE "companyId" = ${companyId}
    ) t WHERE d >= ${start} AND d < ${end} GROUP BY 1, 2`;
  const out: MonthPoint[] = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const mine = rows.filter((r) => { const m = new Date(r.m); return m.getUTCFullYear() === d.getFullYear() && m.getUTCMonth() === d.getMonth(); });
    out.push({ key, name: MONTH(d), income: round2(mine.filter((r) => r.k === "in").reduce((s, r) => s + num(r.v), 0)), expenses: round2(mine.filter((r) => r.k === "out").reduce((s, r) => s + num(r.v), 0)) });
  }
  return out;
}

export async function receivables(companyId: string) {
  const today = startOfDay();
  const inv = await db.invoice.findMany({ where: { companyId, deletedAt: null, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } }, select: { id: true, number: true, clientId: true, total: true, paid: true, dueDate: true, issueDate: true, client: { select: { name: true } } } });
  const open = inv.map((i) => ({ ...i, balance: round2(num(i.total) - num(i.paid)) })).filter((i) => i.balance > 0.005);
  const aging: AgingRow[] = buildAging(open.map((i) => ({ partyId: i.clientId, partyName: i.client.name, balance: i.balance, dueDate: i.dueDate, issueDate: i.issueDate })), today);
  const overdue = open.filter((i) => (i.dueDate ?? i.issueDate) < today);
  return { open, aging, total: round2(open.reduce((s, i) => s + i.balance, 0)), overdueTotal: round2(overdue.reduce((s, i) => s + i.balance, 0)), overdueCount: overdue.length };
}

export async function payables(companyId: string) {
  const today = startOfDay();
  const bills = await db.vendorBill.findMany({ where: { companyId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } }, select: { id: true, number: true, vendorId: true, amount: true, paid: true, dueDate: true, billDate: true, vendor: { select: { name: true } } } });
  const open = bills.map((b) => ({ ...b, balance: round2(num(b.amount) - num(b.paid)) })).filter((b) => b.balance > 0.005);
  const aging: AgingRow[] = buildAging(open.map((b) => ({ partyId: b.vendorId, partyName: b.vendor.name, balance: b.balance, dueDate: b.dueDate, issueDate: b.billDate })), today);
  const overdue = open.filter((b) => (b.dueDate ?? b.billDate) < today);
  return { open, aging, total: round2(open.reduce((s, b) => s + b.balance, 0)), overdueTotal: round2(overdue.reduce((s, b) => s + b.balance, 0)), overdueCount: overdue.length };
}
