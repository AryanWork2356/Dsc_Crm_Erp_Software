import "server-only";
import { db } from "./db";
import { num, round2 } from "./utils";

/**
 * Live project profitability, computed from real records every time (never stored, so it can't go stale).
 *
 *   Revenue   = contract value (excl. GST)
 *   Budget    = estimated cost of the project's current BOQ (falls back to project.budget)
 *   Actual cost, by bucket:
 *     Material = value of material ISSUED to the project from stock
 *              + value of material RECEIVED directly at the project's site location
 *              + approved expenses categorised Material
 *     Labour   = wage cost of worker attendance recorded against the project (+ Labour expenses)
 *     Vendor   = vendor bills for the project that are NOT tied to a PO (services/sub-contract)
 *              + payments made to labour contractors for the project (+ Vendor expenses)
 *     Other    = all remaining approved project expenses
 *   (Stock bought into a warehouse is inventory, not project cost, until it is issued.)
 *
 *   Profit = Revenue − Actual cost,  Margin % = Profit / Revenue
 *   Billing: Billed = invoices issued (excl. GST), Collected = payments received, Outstanding = invoice totals − payments
 */

export type ProjectFinancials = {
  projectId: string;
  contractValue: number;
  budget: number;
  estimatedProfit: number;
  material: number;
  labour: number;
  vendor: number;
  other: number;
  actualCost: number;
  variance: number; // actual − budget (positive = over budget)
  variancePct: number;
  profit: number;
  marginPct: number;
  billed: number;
  collected: number;
  outstanding: number;
  overBudget: boolean;
};

export async function projectFinancials(companyId: string, projectIds: string[]): Promise<Map<string, ProjectFinancials>> {
  const out = new Map<string, ProjectFinancials>();
  if (projectIds.length === 0) return out;

  const [projects, boqs, issues, siteReceipts, attendance, billsNoPo, expenses, invoices, contractorPay] = await Promise.all([
    db.project.findMany({ where: { companyId, id: { in: projectIds } }, select: { id: true, contractValue: true, budget: true } }),
    db.boq.findMany({ where: { companyId, deletedAt: null, projectId: { in: projectIds }, status: { not: "REVISED" } }, select: { projectId: true, status: true, revision: true, items: { select: { estimatedCost: true } } } }),
    db.$queryRaw<{ project_id: string; value: number }[]>`
      SELECT mi."projectId" AS project_id, COALESCE(SUM(it.quantity * it."unitCost"), 0)::float AS value
      FROM "MaterialIssue" mi JOIN "MaterialIssueItem" it ON it."issueId" = mi.id
      WHERE mi."companyId" = ${companyId} AND mi."projectId" = ANY(${projectIds})
      GROUP BY mi."projectId"`,
    db.$queryRaw<{ project_id: string; value: number }[]>`
      SELECT w."projectId" AS project_id, COALESCE(SUM(ri."acceptedQty" * poi.rate), 0)::float AS value
      FROM "MaterialReceipt" r
      JOIN "MaterialReceiptItem" ri ON ri."receiptId" = r.id
      JOIN "PurchaseOrderItem" poi ON poi.id = ri."poItemId"
      JOIN "Warehouse" w ON w.id = r."locationId"
      WHERE r."companyId" = ${companyId} AND w.type = 'SITE' AND w."projectId" = ANY(${projectIds})
      GROUP BY w."projectId"`,
    db.attendance.groupBy({ by: ["projectId"], where: { companyId, projectId: { in: projectIds } }, _sum: { wageCost: true } }),
    db.vendorBill.groupBy({ by: ["projectId"], where: { companyId, projectId: { in: projectIds }, poId: null, status: { not: "CANCELLED" } }, _sum: { amount: true } }),
    db.expense.groupBy({ by: ["projectId", "category"], where: { companyId, projectId: { in: projectIds }, approved: true }, _sum: { amount: true } }),
    db.invoice.findMany({ where: { companyId, deletedAt: null, projectId: { in: projectIds }, status: { notIn: ["DRAFT", "CANCELLED", "PENDING_APPROVAL"] } }, select: { projectId: true, subtotal: true, discount: true, total: true, paid: true } }),
    db.contractorPayment.groupBy({ by: ["projectId"], where: { companyId, projectId: { in: projectIds } }, _sum: { amount: true } }),
  ]);

  const mapNum = <T extends { project_id: string; value: number }>(rows: T[]) => new Map(rows.map((r) => [r.project_id, num(r.value)]));
  const issueMap = mapNum(issues);
  const receiptMap = mapNum(siteReceipts);

  for (const p of projects) {
    // current BOQ = latest non-revised; prefer approved
    const myBoqs = boqs.filter((b) => b.projectId === p.id).sort((a, b) => b.revision - a.revision);
    const boq = myBoqs.find((b) => b.status === "APPROVED") ?? myBoqs[0];
    const boqCost = boq ? boq.items.reduce((s, i) => s + num(i.estimatedCost), 0) : 0;
    const budget = boqCost > 0 ? boqCost : num(p.budget);

    const exp = (cat: string) => expenses.filter((e) => e.projectId === p.id && e.category === cat).reduce((s, e) => s + num(e._sum.amount), 0);
    const expOther = expenses.filter((e) => e.projectId === p.id && !["MATERIAL", "LABOUR", "VENDOR"].includes(e.category)).reduce((s, e) => s + num(e._sum.amount), 0);

    const material = round2((issueMap.get(p.id) ?? 0) + (receiptMap.get(p.id) ?? 0) + exp("MATERIAL"));
    const labour = round2(num(attendance.find((a) => a.projectId === p.id)?._sum.wageCost) + exp("LABOUR"));
    const vendor = round2(num(billsNoPo.find((b) => b.projectId === p.id)?._sum.amount) + num(contractorPay.find((b) => b.projectId === p.id)?._sum.amount) + exp("VENDOR"));
    const other = round2(expOther);
    const actualCost = round2(material + labour + vendor + other);

    const contractValue = num(p.contractValue);
    const profit = round2(contractValue - actualCost);
    const inv = invoices.filter((i) => i.projectId === p.id);
    const billed = round2(inv.reduce((s, i) => s + (num(i.subtotal) - num(i.discount)), 0));
    const billedGross = inv.reduce((s, i) => s + num(i.total), 0);
    const collected = round2(inv.reduce((s, i) => s + num(i.paid), 0));
    const variance = round2(actualCost - budget);

    out.set(p.id, {
      projectId: p.id, contractValue, budget, estimatedProfit: round2(contractValue - budget),
      material, labour, vendor, other, actualCost, variance, variancePct: budget > 0 ? round2((variance / budget) * 100) : 0,
      profit, marginPct: contractValue > 0 ? round2((profit / contractValue) * 100) : 0,
      billed, collected, outstanding: round2(billedGross - collected), overBudget: budget > 0 && actualCost > budget,
    });
  }
  return out;
}

export async function oneProjectFinancials(companyId: string, projectId: string) {
  return (await projectFinancials(companyId, [projectId])).get(projectId) ?? null;
}
