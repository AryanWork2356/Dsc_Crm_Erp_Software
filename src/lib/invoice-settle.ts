import "server-only";
import type { Tx } from "./db";
import { num, round2 } from "./utils";

/** Recomputes paid/status from the payments table (single source of truth) – idempotent and drift-proof. */
export async function settleInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const agg = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
  const paid = round2(num(agg._sum.amount));
  let status = inv.status;
  if (!["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(inv.status)) {
    status = paid + 0.005 >= num(inv.total) && num(inv.total) > 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : inv.dueDate && inv.dueDate < new Date(new Date().toDateString()) ? "OVERDUE" : "SENT";
  }
  await tx.invoice.update({ where: { id: invoiceId }, data: { paid, status } });
  return { paid, status, total: num(inv.total) };
}

