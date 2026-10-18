import "server-only";
import type { Tx } from "./db";
import { num, round2 } from "./utils";

/**
 * Employee advances are recovered from salary in monthly instalments (HR SOP: advances and recoveries register).
 * Payroll plans the recovery for a month, saves it against the advance, and closes the advance when it is repaid.
 * Re-running payroll for the same month replaces that month's recovery – it never doubles it.
 */

export type Planned = { advanceId: string; amount: number };

const period = (m: number, y: number) => y * 12 + m;

export async function planRecoveries(tx: Tx, employeeId: string, month: number, year: number): Promise<{ items: Planned[]; total: number }> {
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  // still recovering – or already repaid but with an instalment in this very month (so a payroll re-run keeps it)
  const open = await tx.employeeAdvance.findMany({ where: { employeeId, givenOn: { lte: endOfMonth }, OR: [{ status: "OPEN" }, { recoveries: { some: { month, year } } }] }, include: { recoveries: true }, orderBy: { givenOn: "asc" } });
  const items: Planned[] = [];
  for (const a of open) {
    const earlier = a.recoveries.filter((r) => period(r.month, r.year) < period(month, year)).reduce((s, r) => s + num(r.amount), 0);
    const outstanding = round2(num(a.amount) - earlier);
    const amount = Math.max(0, Math.min(num(a.monthlyRecovery), outstanding));
    items.push({ advanceId: a.id, amount: round2(amount) });
  }
  return { items, total: round2(items.reduce((s, i) => s + i.amount, 0)) };
}

export async function saveRecoveries(tx: Tx, month: number, year: number, items: Planned[]) {
  for (const i of items) {
    const key = { advanceId_month_year: { advanceId: i.advanceId, month, year } };
    if (i.amount > 0) await tx.advanceRecovery.upsert({ where: key, update: { amount: i.amount }, create: { advanceId: i.advanceId, month, year, amount: i.amount } });
    else await tx.advanceRecovery.deleteMany({ where: { advanceId: i.advanceId, month, year } });
    const a = await tx.employeeAdvance.findUniqueOrThrow({ where: { id: i.advanceId }, include: { recoveries: true } });
    const recovered = a.recoveries.reduce((s, r) => s + num(r.amount), 0);
    const status = recovered + 0.005 >= num(a.amount) ? "CLEARED" : "OPEN";
    if (status !== a.status) await tx.employeeAdvance.update({ where: { id: a.id }, data: { status } });
  }
}

export const balanceOf = (a: { amount: Parameters<typeof num>[0]; recoveries: { amount: Parameters<typeof num>[0] }[] }) => round2(num(a.amount) - a.recoveries.reduce((s, r) => s + num(r.amount), 0));
